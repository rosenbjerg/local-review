package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func gitCmd(t *testing.T, dir string, args ...string) string {
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

// initRepoOn creates a repo whose first commit will land on `branch` (via an unborn
// symbolic-ref, so it's deterministic regardless of the host's init.defaultBranch).
func initRepoOn(t *testing.T, branch string) (string, *Repo) {
	t.Helper()
	dir := t.TempDir()
	gitCmd(t, dir, "init", "-q")
	gitCmd(t, dir, "config", "user.email", "t@example.com")
	gitCmd(t, dir, "config", "user.name", "Tester")
	gitCmd(t, dir, "config", "commit.gpgsign", "false")
	gitCmd(t, dir, "symbolic-ref", "HEAD", "refs/heads/"+branch)
	return dir, New(dir)
}

func firstCommit(t *testing.T, dir string) {
	t.Helper()
	mustWrite(t, dir, "f.txt", "l1\n")
	gitCmd(t, dir, "add", "-A")
	gitCmd(t, dir, "commit", "-q", "-m", "c1")
}

// MainBranch walks a fallback chain; each rung must resolve to the right ref (only
// the local-main rung is otherwise exercised by the diff handler tests).
func TestMainBranch(t *testing.T) {
	t.Run("local main preferred", func(t *testing.T) {
		dir, r := initRepoOn(t, "main")
		firstCommit(t, dir)
		if got := r.MainBranch(); got != "main" {
			t.Errorf("MainBranch = %q, want main", got)
		}
	})

	t.Run("local master when no main", func(t *testing.T) {
		dir, r := initRepoOn(t, "master")
		firstCommit(t, dir)
		if got := r.MainBranch(); got != "master" {
			t.Errorf("MainBranch = %q, want master", got)
		}
	})

	t.Run("remote default via origin/HEAD", func(t *testing.T) {
		dir, r := initRepoOn(t, "work") // no local main/master
		firstCommit(t, dir)
		// origin/HEAD points at a non-main branch, and there is no origin/main|master,
		// so only the origin/HEAD rung can resolve this — isolating that path.
		gitCmd(t, dir, "update-ref", "refs/remotes/origin/develop", "HEAD")
		gitCmd(t, dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop")
		if got := r.MainBranch(); got != "origin/develop" {
			t.Errorf("MainBranch = %q, want origin/develop", got)
		}
	})

	t.Run("origin/main without origin/HEAD", func(t *testing.T) {
		dir, r := initRepoOn(t, "work")
		firstCommit(t, dir)
		gitCmd(t, dir, "update-ref", "refs/remotes/origin/main", "HEAD")
		if got := r.MainBranch(); got != "origin/main" {
			t.Errorf("MainBranch = %q, want origin/main", got)
		}
	})

	t.Run("nothing resolves → empty", func(t *testing.T) {
		dir, r := initRepoOn(t, "work")
		firstCommit(t, dir)
		if got := r.MainBranch(); got != "" {
			t.Errorf("MainBranch = %q, want empty", got)
		}
	})
}

// The fingerprint must change for every kind of real change the poller cares about
// (commit, unstaged edit, new/deleted file) yet stay stable when nothing that
// affects the diff changed — including a no-op rewrite with identical content, so
// an editor "save" doesn't trigger a spurious refetch.
func TestWorktreeFingerprint(t *testing.T) {
	dir, r := initRepoOn(t, "main")
	firstCommit(t, dir)

	fp := func() string {
		s, err := r.WorktreeFingerprint()
		if err != nil {
			t.Fatalf("WorktreeFingerprint: %v", err)
		}
		return s
	}

	base := fp()
	if base != fp() {
		t.Fatal("fingerprint must be stable when nothing changes")
	}

	mustWrite(t, dir, "f.txt", "l1\nl2\n") // unstaged tracked edit
	edited := fp()
	if edited == base {
		t.Error("an unstaged edit should change the fingerprint")
	}

	mustWrite(t, dir, "new.txt", "x\n") // untracked file
	untracked := fp()
	if untracked == edited {
		t.Error("a new untracked file should change the fingerprint")
	}

	gitCmd(t, dir, "add", "-A")
	gitCmd(t, dir, "commit", "-q", "-m", "c2") // HEAD moves, tree goes clean
	committed := fp()
	if committed == untracked {
		t.Error("a commit should change the fingerprint")
	}
	if committed != fp() {
		t.Error("fingerprint must be stable after a commit with a clean tree")
	}

	mustWrite(t, dir, "f.txt", "l1\nl2\n") // rewrite identical content (new mtime)
	if fp() != committed {
		t.Error("a no-op rewrite with identical content must not change the fingerprint")
	}

	if err := os.Remove(filepath.Join(dir, "f.txt")); err != nil { // delete a tracked file
		t.Fatal(err)
	}
	if fp() == committed {
		t.Error("deleting a tracked file should change the fingerprint")
	}
}
