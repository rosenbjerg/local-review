package review

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"local-review/internal/git"
)

// testRepo is a throwaway git repo on branch main. The annotation pass reads real git
// output — hunks, rename detection, index vs worktree — so there is nothing here to fake.
type testRepo struct {
	t    *testing.T
	dir  string
	repo *git.Repo
}

func newRepo(t *testing.T) *testRepo {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "proj")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	r := &testRepo{t: t, dir: dir, repo: git.New(dir)}
	r.git("init", "-q")
	r.git("config", "user.email", "t@example.com")
	r.git("config", "user.name", "Tester")
	r.git("config", "commit.gpgsign", "false")
	r.git("checkout", "-q", "-b", "main")
	return r
}

// git runs a git command in the repo, with the host's global config neutralized so it
// cannot change behavior under test.
func (r *testRepo) git(args ...string) string {
	r.t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = r.dir
	cmd.Env = append(os.Environ(),
		"GIT_CONFIG_GLOBAL=/dev/null",
		"GIT_CONFIG_SYSTEM=/dev/null",
		"GIT_TERMINAL_PROMPT=0",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		r.t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return string(out)
}

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

func hashOf(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}
