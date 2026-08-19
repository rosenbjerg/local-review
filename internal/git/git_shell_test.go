package git

import (
	"errors"
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

// ParentSHA is the before side of an inclusive "from <commit>", so the two cases a
// caller can't recover from on its own have to be distinguishable: a root commit
// (legitimately parentless → the empty tree) and a ref that doesn't resolve.
func TestParentSHA(t *testing.T) {
	dir, r := initRepoOn(t, "main")
	firstCommit(t, dir)
	root := strings.TrimSpace(gitCmd(t, dir, "rev-parse", "HEAD"))
	mustWrite(t, dir, "f.txt", "l1\nl2\n")
	gitCmd(t, dir, "add", "-A")
	gitCmd(t, dir, "commit", "-q", "-m", "c2")

	if got, err := r.ParentSHA("HEAD"); err != nil || got != root {
		t.Errorf("ParentSHA(HEAD) = %q, %v; want %q", got, err, root)
	}
	if got, err := r.ParentSHA(root); err != nil || got != EmptyTreeSHA {
		t.Errorf("ParentSHA(root) = %q, %v; want the empty tree", got, err)
	}
	if _, err := r.ParentSHA("deadbeef"); err == nil {
		t.Error("ParentSHA(unknown ref): want an error")
	}
}

// A comment outlives the file it anchors to, so reads of a vanished path must be
// distinguishable from a real git/IO failure — the caller turns one into a 404 and
// the other into a 500.
func TestFileReadsReportAbsenceAsNotFound(t *testing.T) {
	dir, r := initRepoOn(t, "main")
	firstCommit(t, dir)
	gitCmd(t, dir, "mv", "f.txt", "moved.txt")
	gitCmd(t, dir, "commit", "-q", "-m", "rename")

	notFound := map[string]func() (string, error){
		"path gone from ref":   func() (string, error) { return r.FileContent("main", "f.txt") },
		"ref does not exist":   func() (string, error) { return r.FileContent("nope", "moved.txt") },
		"path gone from index": func() (string, error) { return r.IndexFile("f.txt") },
		"path gone from disk":  func() (string, error) { return r.WorktreeFile("f.txt") },
	}
	for name, read := range notFound {
		if _, err := read(); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s: err = %v, want ErrNotFound", name, err)
		}
	}

	present := map[string]func() (string, error){
		"ref":      func() (string, error) { return r.FileContent("main", "moved.txt") },
		"index":    func() (string, error) { return r.IndexFile("moved.txt") },
		"worktree": func() (string, error) { return r.WorktreeFile("moved.txt") },
	}
	for name, read := range present {
		if got, err := read(); err != nil || got != "l1\n" {
			t.Errorf("%s: = (%q, %v), want (\"l1\\n\", nil)", name, got, err)
		}
	}

	// A rejected path is a bad request, not an absent file.
	if _, err := r.WorktreeFile(".git/config"); err == nil || errors.Is(err, ErrNotFound) {
		t.Errorf("WorktreeFile(.git/config) = %v, want a non-ErrNotFound rejection", err)
	}
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

// A repo with no commits has no branches, and the endpoint's contract is [] rather
// than null: a null reaches the browser as `branches: null`, which the client stores
// and then crashes on. Guard the shape, not just the length.
func TestListBranchesEmptyRepo(t *testing.T) {
	_, r := initRepoOn(t, "main")
	branches, err := r.ListBranches()
	if err != nil {
		t.Fatalf("ListBranches: %v", err)
	}
	if branches == nil {
		t.Fatal("ListBranches returned nil for a commit-less repo; must be an empty slice")
	}
	if len(branches) != 0 {
		t.Errorf("ListBranches = %v, want empty", branches)
	}
}

// The batch reader replaces one `git show` per file with a single command, so it has
// to agree with FileContent exactly — including on the payloads that make a
// line-oriented parse wrong. Sizes come from the record header, never from scanning
// for a delimiter, because file content can hold anything.
func TestBatchObjects(t *testing.T) {
	dir, r := initRepoOn(t, "main")
	mustWrite(t, dir, "plain.txt", "l1\nl2\n")
	mustWrite(t, dir, "noeol.txt", "no trailing newline")
	mustWrite(t, dir, "empty.txt", "")
	// Content that looks like the batch protocol's own framing, plus a NUL.
	mustWrite(t, dir, "tricky.txt", "deadbeef blob 999\nnot a header\x00\nstill mine\n")
	mustWrite(t, dir, "spaced name.txt", "spaces are fine\n")
	gitCmd(t, dir, "add", "-A")
	gitCmd(t, dir, "commit", "-q", "-m", "c1")

	paths := []string{"plain.txt", "noeol.txt", "empty.txt", "tricky.txt", "spaced name.txt"}
	specs := make([]string, len(paths))
	for i, p := range paths {
		specs[i] = "HEAD:" + p
	}
	// A missing path in the middle must not desynchronize the ones after it.
	specs = append(specs[:2], append([]string{"HEAD:absent.txt"}, specs[2:]...)...)

	got, err := r.BatchObjects(specs)
	if err != nil {
		t.Fatalf("BatchObjects: %v", err)
	}

	for _, p := range paths {
		want, fcErr := r.FileContent("HEAD", p)
		if fcErr != nil {
			t.Fatalf("FileContent(%q): %v", p, fcErr)
		}
		if got["HEAD:"+p] != want {
			t.Errorf("BatchObjects[%q] = %q, want %q", p, got["HEAD:"+p], want)
		}
	}
	if _, ok := got["HEAD:absent.txt"]; ok {
		t.Error("a missing path must be absent from the result, not present as empty")
	}
	// An empty file is present-and-empty, which is a different answer from missing.
	if v, ok := got["HEAD:empty.txt"]; !ok || v != "" {
		t.Errorf("empty file = (%q, %v), want (\"\", true)", v, ok)
	}
}

// The index is the other side a review read needs in bulk.
func TestBatchObjectsIndexSide(t *testing.T) {
	dir, r := initRepoOn(t, "main")
	mustWrite(t, dir, "f.txt", "committed\n")
	gitCmd(t, dir, "add", "-A")
	gitCmd(t, dir, "commit", "-q", "-m", "c1")
	mustWrite(t, dir, "f.txt", "staged\n")
	gitCmd(t, dir, "add", "f.txt")
	mustWrite(t, dir, "f.txt", "working\n")

	got, err := r.BatchObjects([]string{":f.txt", "HEAD:f.txt"})
	if err != nil {
		t.Fatalf("BatchObjects: %v", err)
	}
	if got[":f.txt"] != "staged\n" {
		t.Errorf("index read = %q, want %q", got[":f.txt"], "staged\n")
	}
	if got["HEAD:f.txt"] != "committed\n" {
		t.Errorf("head read = %q, want %q", got["HEAD:f.txt"], "committed\n")
	}
}

// Degenerate inputs must not spawn a process or panic.
func TestBatchObjectsEmptyInput(t *testing.T) {
	_, r := initRepoOn(t, "main")
	if got, err := r.BatchObjects(nil); err != nil || len(got) != 0 {
		t.Errorf("BatchObjects(nil) = %v, want empty", got)
	}
	if got, err := r.BatchObjects([]string{"", "HEAD:with\nnewline"}); err != nil || len(got) != 0 {
		t.Errorf("unusable specs should be skipped, got %v", got)
	}
}
