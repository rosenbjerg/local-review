// Command local-review serves a local git review UI and API from a single binary.
package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"local-review/internal/api"
	"local-review/internal/git"
	"local-review/internal/store"
)

//go:embed all:web/dist
var embeddedWeb embed.FS

func main() {
	var (
		repoPath  = flag.String("repo", ".", "path to the git repository to review")
		port      = flag.Int("port", 7777, "port to listen on")
		retention = flag.Int("retention-days", 30, "delete draft reviews older than this many days on startup")
		noOpen    = flag.Bool("no-open", false, "do not open the browser on start")
	)
	flag.Parse()

	absRepo, err := filepath.Abs(*repoPath)
	if err != nil {
		log.Fatalf("resolve repo path: %v", err)
	}
	repo := git.New(absRepo)
	if _, err := repo.MergeBase("HEAD", "HEAD"); err != nil {
		log.Fatalf("%s does not look like a git repository: %v", absRepo, err)
	}

	dbPath := resolveDBPath()
	st, err := store.Open(dbPath)
	if err != nil {
		log.Fatalf("open store (%s): %v", dbPath, err)
	}
	defer st.Close()

	if n, err := st.PruneDrafts(time.Duration(*retention) * 24 * time.Hour); err != nil {
		log.Printf("prune drafts: %v", err)
	} else if n > 0 {
		log.Printf("pruned %d stale draft review(s)", n)
	}

	mux := http.NewServeMux()
	api.New(repo, st).Routes(mux)
	mountStatic(mux)

	addr := fmt.Sprintf("127.0.0.1:%d", *port)
	url := "http://" + addr
	log.Printf("local-review reviewing %s", absRepo)
	log.Printf("db: %s", dbPath)
	log.Printf("listening on %s", url)

	if !*noOpen {
		go openBrowser(url)
	}
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}

// resolveDBPath places the DB next to the binary, falling back to an app data
// dir if that directory is not writable.
func resolveDBPath() string {
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		candidate := filepath.Join(dir, "local-review.db")
		if writable(dir) {
			return candidate
		}
	}
	if data, err := os.UserConfigDir(); err == nil {
		dir := filepath.Join(data, "local-review")
		if err := os.MkdirAll(dir, 0o755); err == nil {
			return filepath.Join(dir, "local-review.db")
		}
	}
	return "local-review.db"
}

func writable(dir string) bool {
	f, err := os.CreateTemp(dir, ".write-test-*")
	if err != nil {
		return false
	}
	name := f.Name()
	f.Close()
	os.Remove(name)
	return true
}

func mountStatic(mux *http.ServeMux) {
	sub, err := fs.Sub(embeddedWeb, "web/dist")
	if err != nil {
		log.Printf("static assets unavailable: %v", err)
		return
	}
	fileServer := http.FileServer(http.FS(sub))
	// Serve assets, falling back to index.html for client-side routing.
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if _, err := fs.Stat(sub, filepath.Clean(r.URL.Path[1:])); err == nil || r.URL.Path == "/" {
			fileServer.ServeHTTP(w, r)
			return
		}
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	})
}

func openBrowser(url string) {
	time.Sleep(300 * time.Millisecond)
	var cmd string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		cmd = "open"
	case "windows":
		cmd = "rundll32"
		args = []string{"url.dll,FileProtocolHandler"}
	default:
		cmd = "xdg-open"
	}
	args = append(args, url)
	_ = exec.Command(cmd, args...).Start()
}
