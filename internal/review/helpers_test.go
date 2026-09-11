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
	// Set by countGit: where the shim records the calls of the run in progress.
	gitLog string
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

// sha resolves a ref the way the annotation pass does; a ref that won't resolve yields "",
// which is exactly what blocker would have refused on.
func (r *testRepo) sha(ref string) string {
	out, _ := r.repo.ResolveSHA(ref)
	return out
}

// commitAll stages everything and commits, returning the new HEAD sha.
func (r *testRepo) commitAll(msg string) string {
	r.git("add", "-A")
	r.git("commit", "-q", "-m", msg)
	return strings.TrimSpace(r.git("rev-parse", "HEAD"))
}

// countGit runs fn with a counting shim ahead of the real git on PATH, and reports how
// many git processes it spawned. The cache's whole point is processes not spawned, and
// nothing short of counting them actually proves that.
func (r *testRepo) countGit(fn func()) int {
	r.t.Helper()
	r.gitLog = filepath.Join(r.t.TempDir(), "git-calls.log")
	real, err := exec.LookPath("git")
	if err != nil {
		r.t.Skip("git not on PATH")
	}
	shimDir := r.t.TempDir()
	shim := filepath.Join(shimDir, "git")
	script := "#!/bin/sh\nprintf '%s\\n' \"$*\" >> " + r.gitLog + "\nexec " + real + " \"$@\"\n"
	if err := os.WriteFile(shim, []byte(script), 0o755); err != nil {
		r.t.Fatal(err)
	}
	r.t.Setenv("PATH", shimDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	fn()
	return len(r.gitCalls())
}

// gitCalls reads back the argument lines the shim recorded.
func (r *testRepo) gitCalls() []string {
	b, err := os.ReadFile(r.gitLog)
	if err != nil {
		return nil
	}
	var out []string
	for _, l := range strings.Split(string(b), "\n") {
		if strings.TrimSpace(l) != "" {
			out = append(out, l)
		}
	}
	return out
}

// countGitCmd counts the recorded calls whose subcommand is name, ignoring the leading
// `-C <path>` and any `-c key=value` the caller set.
func (r *testRepo) countGitCmd(name string) int {
	n := 0
	for _, call := range r.gitCalls() {
		f := strings.Fields(call)
		for len(f) >= 2 && (f[0] == "-C" || f[0] == "-c") {
			f = f[2:]
		}
		if len(f) > 0 && f[0] == name {
			n++
		}
	}
	return n
}

func hashOf(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}
