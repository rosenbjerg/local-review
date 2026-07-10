package git

import (
	"os"
	"path/filepath"
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
	for _, bad := range []string{"../escape", "../../etc/hosts", ".git", ".git/config"} {
		if _, err := r.WorktreeFile(bad); err == nil {
			t.Errorf("WorktreeFile(%q) should be rejected", bad)
		}
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
	files := parseDiff(diff)
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
	files := parseDiff(diff)
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
	files := parseDiff(diff)
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
	hunks := parseDiff(
		"diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,5 @@\n+new1\n+new2\n a\n b\n c\n",
	)[0].Hunks
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
	del := parseDiff(
		"diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n-old\n+new\n c\n",
	)[0].Hunks
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
