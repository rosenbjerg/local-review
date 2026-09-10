package workspace

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Open must reject anything that isn't a single path segment naming a real repo
// under the root — the path-traversal guard.
func TestOpenTraversal(t *testing.T) {
	root := t.TempDir()
	mkRepo(t, root, "proj", time.Now())
	w := New(root)

	if _, err := w.Open("proj"); err != nil {
		t.Errorf("Open(\"proj\") = %v, want a repo", err)
	}
	for _, bad := range []string{"", ".", "..", "../proj", "a/b", `a\b`, "nope"} {
		if _, err := w.Open(bad); err == nil {
			t.Errorf("Open(%q) should be rejected", bad)
		}
	}
}

// A symlink placed in the root that resolves to a git repo *outside* the root must
// be rejected — git.IsRepo's os.Stat follows the symlink, so only the resolved-path
// confinement stops it.
func TestOpenSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	w := New(root)

	outside := t.TempDir() // an external "repo" (has a .git dir) outside the served root
	if err := os.MkdirAll(filepath.Join(outside, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Skipf("symlinks unsupported: %v", err)
	}
	if _, err := w.Open("escape"); err == nil {
		t.Error("Open should reject a symlink resolving outside the root")
	}
}

// mkRepo creates a repo directory under root whose reflog carries the given mtime,
// which is what dates the repo. List only stats, so no real git repo is needed.
func mkRepo(t *testing.T, root, name string, mtime time.Time) {
	t.Helper()
	logs := filepath.Join(root, name, ".git", "logs")
	if err := os.MkdirAll(logs, 0o755); err != nil {
		t.Fatal(err)
	}
	head := filepath.Join(logs, "HEAD")
	if err := os.WriteFile(head, []byte("0000 1111 Tester <t@example.com> 0 +0000\tcommit: x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(head, mtime, mtime); err != nil {
		t.Fatal(err)
	}
}

// The picker lists the repo you last worked in first, but by *date* only: the two
// repos you switch between all day share a date, and ordering them by the time of
// day would make them trade places on every commit. So a same-day pair is
// alphabetical — "delta" worked on eight hours after "beta" still sorts below it —
// while an earlier day sinks whatever its name.
func TestListReposOrder(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 9, 0, 0, 0, time.Local)
	mkRepo(t, root, "delta", today.Add(8*time.Hour)) // today, latest
	mkRepo(t, root, "beta", today)                   // today, earliest
	mkRepo(t, root, "alpha", today.AddDate(0, 0, -3))
	mkRepo(t, root, "zulu", today.AddDate(0, 0, -1))
	if err := os.WriteFile(filepath.Join(root, "loose.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "notarepo"), 0o755); err != nil {
		t.Fatal(err)
	}

	w := New(root)
	repos, err := w.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	var got []string
	for _, r := range repos {
		got = append(got, r.Name)
		if r.LastActivity == "" {
			t.Errorf("repo %q carries no lastActivity date", r.Name)
		}
		if len(r.LastActivity) != len("2006-01-02") {
			t.Errorf("repo %q lastActivity = %q, want a bare date", r.Name, r.LastActivity)
		}
	}
	want := []string{"beta", "delta", "zulu", "alpha"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("List = %v, want %v", got, want)
	}
}

// A repo whose .git is a gitlink *file* (a worktree or submodule) has no logs/ under
// it, so the date has to come off .git itself rather than being dropped.
func TestActivityDateGitlink(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "linked")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	dotGit := filepath.Join(dir, ".git")
	if err := os.WriteFile(dotGit, []byte("gitdir: /elsewhere/.git/worktrees/linked\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	when := time.Date(2024, 3, 4, 12, 0, 0, 0, time.Local)
	if err := os.Chtimes(dotGit, when, when); err != nil {
		t.Fatal(err)
	}
	if got := activityDate(dir); got != "2024-03-04" {
		t.Errorf("activityDate = %q, want 2024-03-04", got)
	}
}
