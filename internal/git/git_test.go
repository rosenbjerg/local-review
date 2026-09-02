package git

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// WorktreeFile reads on-disk content (the uncommitted new side) but must stay
// confined to the repo: no ".." escape and no reaching into .git.
func TestWorktreeFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	r := New(dir)

	if got, err := r.WorktreeFile("a.txt"); err != nil || got != "hello\n" {
		t.Fatalf("WorktreeFile(a.txt) = (%q, %v), want (\"hello\\n\", nil)", got, err)
	}
	// Case variants of .git must also be rejected — a case-insensitive
	// filesystem resolves ".GIT" to the real .git directory.
	for _, bad := range []string{"../escape", "../../etc/hosts", ".git", ".git/config", ".GIT/config", ".Git/HEAD"} {
		if _, err := r.WorktreeFile(bad); err == nil {
			t.Errorf("WorktreeFile(%q) should be rejected", bad)
		}
	}
}

// A symlink inside the repo pointing outside it must not be followed out of the
// tree; a symlink to a file inside the repo stays readable.
func TestWorktreeFileSymlinkEscape(t *testing.T) {
	dir := t.TempDir()
	outside := filepath.Join(t.TempDir(), "secret.txt")
	if err := os.WriteFile(outside, []byte("secret\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	r := New(dir)

	if err := os.Symlink(outside, filepath.Join(dir, "escape.txt")); err != nil {
		t.Skipf("symlinks unsupported: %v", err)
	}
	if _, err := r.WorktreeFile("escape.txt"); err == nil {
		t.Error("WorktreeFile should reject a symlink escaping the repo")
	}

	mustWrite(t, dir, "real.txt", "inside\n")
	if err := os.Symlink(filepath.Join(dir, "real.txt"), filepath.Join(dir, "inlink.txt")); err != nil {
		t.Skipf("symlinks unsupported: %v", err)
	}
	if got, err := r.WorktreeFile("inlink.txt"); err != nil || got != "inside\n" {
		t.Errorf("WorktreeFile(inlink.txt) = (%q, %v), want (\"inside\\n\", nil)", got, err)
	}

	// A symlink pointing at .git resolves back *inside* the root, so the outward-escape
	// check passes — it must still be rejected, else it leaks .git internals (config,
	// hooks). This exercises the .git re-check on the symlink-resolved path.
	if err := os.MkdirAll(filepath.Join(dir, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".git", "config"), []byte("[core]\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(dir, ".git"), filepath.Join(dir, "gitlink")); err != nil {
		t.Skipf("symlinks unsupported: %v", err)
	}
	if _, err := r.WorktreeFile("gitlink/config"); err == nil {
		t.Error("WorktreeFile should reject a symlink that resolves into .git")
	}
}

// newFileDiff synthesizes an added diff for an untracked file: a text file gets
// one all-add hunk; empty and binary files get none.
func TestNewFileDiff(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, dir, "a.txt", "l1\nl2\n")
	mustWrite(t, dir, "empty.txt", "")
	if err := os.WriteFile(filepath.Join(dir, "bin.dat"), []byte{0, 1, 2}, 0o644); err != nil {
		t.Fatal(err)
	}
	r := New(dir)

	fd, ok := r.newFileDiff("a.txt")
	if !ok || fd.Status != "added" || fd.NewPath != "a.txt" || len(fd.Hunks) != 1 {
		t.Fatalf("text: got ok=%v status=%q hunks=%d", ok, fd.Status, len(fd.Hunks))
	}
	if ls := fd.Hunks[0].Lines; len(ls) != 2 || ls[0].Kind != "add" || ls[0].NewLine != 1 || ls[0].Content != "l1" {
		t.Fatalf("text lines wrong: %+v", ls)
	}
	for _, name := range []string{"empty.txt", "bin.dat"} {
		fd, ok := r.newFileDiff(name)
		if !ok || len(fd.Hunks) != 0 {
			t.Errorf("%s: expected added with no hunks, got ok=%v hunks=%d", name, ok, len(fd.Hunks))
		}
	}
	if _, ok := r.newFileDiff("missing.txt"); ok {
		t.Error("missing file should not produce a diff")
	}
}

func mustWrite(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestParseHunkHeader(t *testing.T) {
	cases := []struct {
		name             string
		header           string
		wantOld, wantNew int
	}{
		{"plain", "@@ -12,7 +12,9 @@ func normal() {", 12, 12},
		{"python return arrow", "@@ -40,6 +42,8 @@ def foo(x: int) -> str:", 40, 42},
		{"rust return arrow", "@@ -100,4 +100,4 @@ fn f() -> Result<T, E> {", 100, 100},
		{"plus in heading", "@@ -5,2 +5,3 @@ total += 1", 5, 5},
		{"negative literal in heading", "@@ -10,3 +10,4 @@ if x == -1 {", 10, 10},
		{"single-line ranges", "@@ -1 +1 @@", 1, 1},
		{"no heading", "@@ -20,5 +30,6 @@", 20, 30},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			gotOld, gotNew := parseHunkHeader(c.header)
			if gotOld != c.wantOld || gotNew != c.wantNew {
				t.Errorf("parseHunkHeader(%q) = (old=%d, new=%d), want (old=%d, new=%d)",
					c.header, gotOld, gotNew, c.wantOld, c.wantNew)
			}
		})
	}
}

// Binary and mode-only changes emit no ---/+++ or rename lines, so their paths
// must come from the "diff --git" header — otherwise they render with an empty
// name in the file list.
func TestParseDiffHeaderOnlyPaths(t *testing.T) {
	diff := "diff --git a/.claude/hook.sh b/.claude/hook.sh\n" +
		"old mode 100755\n" +
		"new mode 100644\n" +
		"diff --git a/asset.bin b/asset.bin\n" +
		"index e69de29..d95f3ad 100644\n" +
		"Binary files a/asset.bin and b/asset.bin differ\n" +
		"diff --git a/normal.txt b/normal.txt\n" +
		"--- a/normal.txt\n" +
		"+++ b/normal.txt\n" +
		"@@ -1 +1,2 @@\n" +
		" text\n" +
		"+more\n"
	files, err := parseDiff(diff)
	if err != nil {
		t.Fatalf("parseDiff: %v", err)
	}
	want := []string{".claude/hook.sh", "asset.bin", "normal.txt"}
	if len(files) != len(want) {
		t.Fatalf("got %d files, want %d", len(files), len(want))
	}
	for i, f := range files {
		name := f.NewPath
		if name == "" {
			name = f.OldPath
		}
		if name != want[i] {
			t.Errorf("file %d: name %q, want %q", i, name, want[i])
		}
	}
}

// Added and deleted binary files carry no ---/+++ lines, so the header seeds
// both sides; the new-file/deleted-file lines must then clear the side that
// doesn't exist, matching how text add/delete resolve via /dev/null.
func TestParseDiffAddedDeletedBinaryPaths(t *testing.T) {
	diff := "diff --git a/new.bin b/new.bin\n" +
		"new file mode 100644\n" +
		"index 0000000..d95f3ad\n" +
		"Binary files /dev/null and b/new.bin differ\n" +
		"diff --git a/gone.bin b/gone.bin\n" +
		"deleted file mode 100644\n" +
		"index d95f3ad..0000000\n" +
		"Binary files a/gone.bin and /dev/null differ\n"
	files, err := parseDiff(diff)
	if err != nil {
		t.Fatalf("parseDiff: %v", err)
	}
	if len(files) != 2 {
		t.Fatalf("got %d files, want 2", len(files))
	}
	if files[0].Status != "added" || files[0].OldPath != "" || files[0].NewPath != "new.bin" {
		t.Errorf("added binary: got status=%q old=%q new=%q, want added/\"\"/new.bin",
			files[0].Status, files[0].OldPath, files[0].NewPath)
	}
	if files[1].Status != "deleted" || files[1].NewPath != "" || files[1].OldPath != "gone.bin" {
		t.Errorf("deleted binary: got status=%q old=%q new=%q, want deleted/gone.bin/\"\"",
			files[1].Status, files[1].OldPath, files[1].NewPath)
	}
}

// A hunk content line can look like a file header: a deleted "-- x" line becomes
// "--- x" in the diff and an added "++ x" becomes "+++ x". These must be parsed
// as content, not as the ---/+++ path headers (which would drop the line and
// corrupt line numbers).
func TestParseDiffContentLooksLikeHeader(t *testing.T) {
	diff := "diff --git a/q.sql b/q.sql\n" +
		"index 0000000..1111111 100644\n" +
		"--- a/q.sql\n" +
		"+++ b/q.sql\n" +
		"@@ -1,3 +1,3 @@\n" +
		" SELECT 1;\n" +
		"--- old comment\n" +
		"+++ new comment\n" +
		" SELECT 2;\n"
	files, err := parseDiff(diff)
	if err != nil {
		t.Fatalf("parseDiff: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("got %d files, want 1", len(files))
	}
	f := files[0]
	if f.OldPath != "q.sql" || f.NewPath != "q.sql" {
		t.Fatalf("paths corrupted by content: old=%q new=%q", f.OldPath, f.NewPath)
	}
	want := []DiffLine{
		{Kind: "context", OldLine: 1, NewLine: 1, Content: "SELECT 1;"},
		{Kind: "del", OldLine: 2, Content: "-- old comment"},
		{Kind: "add", NewLine: 2, Content: "++ new comment"},
		{Kind: "context", OldLine: 3, NewLine: 3, Content: "SELECT 2;"},
	}
	got := f.Hunks[0].Lines
	if len(got) != len(want) {
		t.Fatalf("got %d lines, want %d: %+v", len(got), len(want), got)
	}
	for i, w := range want {
		if got[i] != w {
			t.Errorf("line %d: got %+v, want %+v", i, got[i], w)
		}
	}
}

// MapOldLine tracks a line across a diff: lines shift past hunks, survive as
// context, and report dead when deleted.
func TestMapOldLine(t *testing.T) {
	// Insert two lines at the top: @@ -1,3 +1,5 @@  +new1 +new2  ctxA ctxB ctxC
	parsed, err := parseDiff(
		"diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,5 @@\n+new1\n+new2\n a\n b\n c\n",
	)
	if err != nil {
		t.Fatalf("parseDiff: %v", err)
	}
	hunks := parsed[0].Hunks
	for _, c := range []struct {
		old, wantNew int
		wantAlive    bool
	}{
		{1, 3, true},   // 'a' shifted down by 2
		{2, 4, true},   // 'b'
		{3, 5, true},   // 'c'
		{10, 12, true}, // past the hunk: shifted by net +2
	} {
		got, alive := MapOldLine(hunks, c.old)
		if got != c.wantNew || alive != c.wantAlive {
			t.Errorf("MapOldLine(%d) = (%d, %v), want (%d, %v)", c.old, got, alive, c.wantNew, c.wantAlive)
		}
	}

	// Modify line 2 in place: @@ -1,3 +1,3 @@  a  -old  +new  c
	parsedDel, err := parseDiff(
		"diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n-old\n+new\n c\n",
	)
	if err != nil {
		t.Fatalf("parseDiff: %v", err)
	}
	del := parsedDel[0].Hunks
	if _, alive := MapOldLine(del, 2); alive {
		t.Errorf("MapOldLine of a deleted/modified line should be dead")
	}
	if got, alive := MapOldLine(del, 3); !alive || got != 3 {
		t.Errorf("MapOldLine(3) = (%d, %v), want (3, true)", got, alive)
	}
}

func TestParseGitHeaderPaths(t *testing.T) {
	cases := []struct {
		line, wantOld, wantNew string
	}{
		{"diff --git a/foo.txt b/foo.txt", "foo.txt", "foo.txt"},
		{"diff --git a/.claude/hook.sh b/.claude/hook.sh", ".claude/hook.sh", ".claude/hook.sh"},
		{"diff --git a/old/name.go b/new/name.go", "old/name.go", "new/name.go"},
	}
	for _, c := range cases {
		gotOld, gotNew := parseGitHeaderPaths(c.line)
		if gotOld != c.wantOld || gotNew != c.wantNew {
			t.Errorf("parseGitHeaderPaths(%q) = (%q, %q), want (%q, %q)",
				c.line, gotOld, gotNew, c.wantOld, c.wantNew)
		}
	}
}

// A diff line longer than the scanner buffer (a minified bundle on one line)
// must surface an error rather than silently truncate the stream and drop every
// file after the offending one.
func TestParseDiffOverlongLine(t *testing.T) {
	huge := strings.Repeat("x", 17*1024*1024)
	diff := "diff --git a/big.js b/big.js\n" +
		"--- a/big.js\n+++ b/big.js\n@@ -1 +1 @@\n" +
		"+" + huge + "\n" +
		"diff --git a/after.txt b/after.txt\n" +
		"--- a/after.txt\n+++ b/after.txt\n@@ -1 +1 @@\n+kept\n"
	if _, err := parseDiff(diff); err == nil {
		t.Fatal("parseDiff of an over-long line should error, got nil (files silently truncated)")
	}
}

// The branch pickers order by last activity, but grouped by prefix: a prefix's
// branches stay adjacent and the group sits at its newest member's date. Ordering
// the branches flatly instead would scatter "abc/*" through the list, and ordering
// the groups by anything but their newest member (their oldest, say) would sink an
// active prefix below a stale one. Pinned trunks stay on top whatever their date,
// and locals stay ahead of remotes.
func TestSortBranches(t *testing.T) {
	at := func(name, date string) Branch { return Branch{Name: name, LastCommit: date} }
	remote := func(name, date string) Branch {
		return Branch{Name: name, LastCommit: date, IsRemote: true}
	}
	branches := []Branch{
		at("abc/old", "2026-01-02T00:00:00Z"),
		remote("origin/abc/x", "2026-04-01T00:00:00Z"),
		at("zzz/only", "2026-02-01T00:00:00Z"),
		at("main", "2025-01-01T00:00:00Z"), // pinned, and the oldest thing here
		at("solo", "2026-03-01T00:00:00Z"),
		at("abc/new", "2026-05-01T00:00:00Z"),
		remote("origin/main", "2026-01-01T00:00:00Z"),    // pinned, and the oldest remote
		remote("origin/staging", "2026-01-01T00:00:00Z"), // pinned lower than main
	}
	sortBranches(branches)
	got := make([]string, len(branches))
	for i, b := range branches {
		got[i] = b.Name
	}
	want := []string{
		"main",           // pinned first, despite being the oldest
		"abc/new",        // "abc" leads: its newest member is the newest branch
		"abc/old",        // and it keeps its prefix's company rather than its date's
		"solo",           // slashless branches take their own place by date
		"zzz/only",       //
		"origin/main",    // remotes after every local, but their trunks first —
		"origin/staging", // ranked on the name after the remote, in pinned order —
		"origin/abc/x",   // even though this one is the newest remote by a month
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("sortBranches = %v, want %v", got, want)
		}
	}
}

// A branch with no committer date (git reported none, or an unparseable one) must
// still sort — oldest — rather than reorder the list unpredictably.
func TestSortBranchesUndatedSortsLast(t *testing.T) {
	branches := []Branch{
		{Name: "undated"},
		{Name: "dated", LastCommit: "2020-01-01T00:00:00Z"},
	}
	sortBranches(branches)
	if branches[0].Name != "dated" {
		t.Errorf("undated branch sorted ahead of a dated one: %v", branches)
	}
}

// The remote name is neither the prefix that groups a remote branch nor part of the
// name that ranks it: origin/abc/* groups as "origin/abc", and origin/main has to
// rank as the trunk "main" does, or the base picker buries it by date.
func TestBranchRank(t *testing.T) {
	main := branchRank(Branch{Name: "main"})
	cases := []struct {
		b    Branch
		want int
	}{
		{Branch{Name: "origin/main", IsRemote: true}, main},
		{Branch{Name: "upstream/main", IsRemote: true}, main},
		{Branch{Name: "origin/development", IsRemote: true}, branchRank(Branch{Name: "development"})},
		{Branch{Name: "origin/abc/main", IsRemote: true}, len(pinnedBranches)}, // not a trunk
		{Branch{Name: "origin/main"}, len(pinnedBranches)},                     // a *local* by that name isn't one either
		{Branch{Name: "feature/x"}, len(pinnedBranches)},
	}
	for _, c := range cases {
		if got := branchRank(c.b); got != c.want {
			t.Errorf("branchRank(%q, remote=%v) = %d, want %d", c.b.Name, c.b.IsRemote, got, c.want)
		}
	}
	if branchRank(Branch{Name: "origin/staging", IsRemote: true}) <= main {
		t.Error("origin/staging must rank below origin/main, as staging does below main")
	}
}

func TestBranchGroup(t *testing.T) {
	cases := []struct {
		b    Branch
		want string
	}{
		{Branch{Name: "abc/feature"}, "abc"},
		{Branch{Name: "solo"}, "solo"},
		{Branch{Name: "origin/abc/feature", IsRemote: true}, "origin/abc"},
		{Branch{Name: "origin/main", IsRemote: true}, "origin/main"},
		{Branch{Name: "weird", IsRemote: true}, "weird"},
	}
	for _, c := range cases {
		if got := branchGroup(c.b); got != c.want {
			t.Errorf("branchGroup(%q, remote=%v) = %q, want %q", c.b.Name, c.b.IsRemote, got, c.want)
		}
	}
}
