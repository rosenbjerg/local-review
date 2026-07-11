// Command local-review serves a local git review UI and API from a single binary.
package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"local-review/internal/api"
	"local-review/internal/store"
)

//go:embed all:web/dist
var embeddedWeb embed.FS

func main() {
	var (
		rootPath  = flag.String("root", ".", "path to a folder containing one or more git repositories")
		port      = flag.Int("port", 7777, "port to listen on")
		retention = flag.Int("retention-days", 30, "delete draft reviews older than this many days on startup (0 or less disables pruning)")
		noOpen    = flag.Bool("no-open", false, "do not open the browser on start")
		dataDir   = flag.String("data-dir", "", "directory for local-review's data (SQLite DB); defaults to ~/.local-review")
	)
	flag.Parse()

	absRoot, err := filepath.Abs(*rootPath)
	if err != nil {
		log.Fatalf("resolve root path: %v", err)
	}
	if info, err := os.Stat(absRoot); err != nil || !info.IsDir() {
		log.Fatalf("%s is not a directory", absRoot)
	}

	dbPath, err := resolveDBPath(*dataDir)
	if err != nil {
		log.Fatal(err)
	}
	st, err := store.Open(dbPath)
	if err != nil {
		log.Fatalf("open store (%s): %v", dbPath, err)
	}
	defer st.Close()

	// A non-positive retention would put the cutoff at (or after) now, deleting
	// every draft review — so treat 0 or less as "keep drafts forever" rather
	// than silently wiping all in-progress work.
	if *retention <= 0 {
		log.Print("retention-days <= 0: draft pruning disabled")
	} else if n, err := st.PruneDrafts(time.Duration(*retention) * 24 * time.Hour); err != nil {
		log.Printf("prune drafts: %v", err)
	} else if n > 0 {
		log.Printf("pruned %d stale draft review(s)", n)
	}

	mux := http.NewServeMux()
	api.New(absRoot, st).Routes(mux)
	mountStatic(mux)

	addr := fmt.Sprintf("127.0.0.1:%d", *port)
	url := "http://" + addr

	// Bind explicitly so a failure (e.g. the port is already in use) aborts here,
	// before we open a browser tab pointed at a server that isn't listening.
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("listen on %s: %v", addr, err)
	}

	log.Printf("local-review serving repositories in %s", absRoot)
	log.Printf("db: %s", dbPath)
	log.Printf("listening on %s", url)

	srv := &http.Server{Handler: api.WithErrorLogging(mux)}
	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.Serve(ln) }()

	// The listener is up, so the browser will reach a live server.
	if !*noOpen {
		go openBrowser(url)
	}

	// Run until a shutdown signal or a fatal serve error, then drain in-flight
	// requests and let the deferred st.Close() checkpoint the WAL cleanly.
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	select {
	case err := <-serveErr:
		if err != nil && err != http.ErrServerClosed {
			log.Fatalf("serve: %v", err)
		}
	case s := <-sig:
		log.Printf("received %s, shutting down", s)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("graceful shutdown: %v", err)
		}
	}
}

// resolveDBPath returns the SQLite DB path inside the data directory, creating
// the directory if needed. An empty dir defaults to ~/.local-review; a leading
// ~ is expanded, and the path is made absolute.
func resolveDBPath(dir string) (string, error) {
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolve home directory: %w", err)
		}
		dir = filepath.Join(home, ".local-review")
	} else {
		dir = expandHome(dir)
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", fmt.Errorf("resolve data dir %q: %w", dir, err)
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return "", fmt.Errorf("create data dir %s: %w", abs, err)
	}
	return filepath.Join(abs, "local-review.db"), nil
}

// expandHome resolves a leading ~ (or ~/…) to the user's home directory.
func expandHome(p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, strings.TrimPrefix(p, "~"))
		}
	}
	return p
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
		// An unknown /api/* path must 404, not fall through to index.html: an API
		// client hitting a removed/typo'd endpoint should get a JSON error, not a
		// 200 HTML page (which also wouldn't be logged as an error).
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"not found"}`))
			return
		}
		// path.Clean (not filepath.Clean): io/fs paths are always slash-separated,
		// but filepath.Clean would emit backslashes on Windows, so the asset
		// lookup would miss and every bundle fall back to index.html.
		if _, err := fs.Stat(sub, path.Clean(r.URL.Path[1:])); err == nil || r.URL.Path == "/" {
			fileServer.ServeHTTP(w, r)
			return
		}
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	})
}

func openBrowser(url string) {
	// The caller only starts this once the listener is bound, so no wait is
	// needed — a connection to the bound socket queues until Serve accepts it.
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
