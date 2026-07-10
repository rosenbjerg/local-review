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
