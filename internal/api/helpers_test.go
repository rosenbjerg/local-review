package api

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"local-review/internal/git"
	"local-review/internal/store"
)

// runGit runs a git command in dir, failing the test on error. The config env is
// neutralized so the host's global git config can't change behavior under test.
func runGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_CONFIG_GLOBAL=/dev/null",
		"GIT_CONFIG_SYSTEM=/dev/null",
		"GIT_TERMINAL_PROMPT=0",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return string(out)
}

// testRepo is a throwaway git repo (on branch main) living under a fresh root, so
// the same fixture serves both the git-reading logic and the HTTP handlers (which
// validate the repo name against the server Root).
type testRepo struct {
	t    *testing.T
	root string // server Root; the repo is root/name
	name string
	dir  string
	repo *git.Repo
}

func newRepo(t *testing.T) *testRepo {
	t.Helper()
	root := t.TempDir()
	name := "proj"
	dir := filepath.Join(root, name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	r := &testRepo{t: t, root: root, name: name, dir: dir, repo: git.New(dir)}
	r.git("init", "-q")
	r.git("config", "user.email", "t@example.com")
	r.git("config", "user.name", "Tester")
	r.git("config", "commit.gpgsign", "false")
	r.git("checkout", "-q", "-b", "main")
	return r
}

func (r *testRepo) git(args ...string) string { return runGit(r.t, r.dir, args...) }

func (r *testRepo) write(name, content string) {
	r.t.Helper()
	p := filepath.Join(r.dir, name)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		r.t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		r.t.Fatal(err)
	}
}

func (r *testRepo) remove(name string) {
	r.t.Helper()
	if err := os.Remove(filepath.Join(r.dir, name)); err != nil {
		r.t.Fatal(err)
	}
}

// commitAll stages everything and commits, returning the new HEAD sha.
func (r *testRepo) commitAll(msg string) string {
	r.git("add", "-A")
	r.git("commit", "-q", "-m", msg)
	return strings.TrimSpace(r.git("rev-parse", "HEAD"))
}

// server builds a Server rooted at the repo's parent, with a fresh temp store.
func (r *testRepo) server() *Server {
	st, err := store.Open(filepath.Join(r.t.TempDir(), "test.db"))
	if err != nil {
		r.t.Fatalf("store.Open: %v", err)
	}
	r.t.Cleanup(func() { _ = st.Close() })
	return New(r.root, st)
}

func hashOf(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func sortedStrings(in []string) []string {
	out := append([]string(nil), in...)
	sort.Strings(out)
	return out
}
