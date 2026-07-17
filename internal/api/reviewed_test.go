package api

import (
	"testing"

	"local-review/internal/store"
)

// fileContentHash must hash the content of the side named by the flags, so the same
// path yields distinct hashes for head / working tree / index when they differ.
func TestFileContentHashPerSide(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "head\n")
	r.commitAll("c1")
	r.write("f.txt", "staged\n")
	r.git("add", "f.txt")
	r.write("f.txt", "work\n") // unstaged on top

	cases := []struct {
		name              string
		worktree, indexed bool
		want              string
	}{
		{"head", false, false, hashOf("head\n")},
		{"worktree", true, false, hashOf("work\n")},
		{"index", false, true, hashOf("staged\n")},
	}
	for _, c := range cases {
		if got := fileContentHash(r.repo, "main", "f.txt", c.worktree, c.indexed); got != c.want {
			t.Errorf("fileContentHash[%s] = %q, want %q", c.name, got, c.want)
		}
	}
}

// An unreadable side (a file that doesn't exist there) hashes to the absent
// sentinel — not "" (which would pin a mark forever) and not a real hash.
func TestFileContentHashAbsentSentinel(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "x\n")
	r.commitAll("c1")

	if got := fileContentHash(r.repo, "main", "gone.txt", false, false); got != absentContentHash {
		t.Errorf("missing head file = %q, want %q", got, absentContentHash)
	}
	if got := fileContentHash(r.repo, "main", "gone.txt", true, false); got != absentContentHash {
		t.Errorf("missing worktree file = %q, want %q", got, absentContentHash)
	}
}

func TestReviewedMarkHolds(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "hello\n")
	r.commitAll("c1")

	// Legacy pre-fingerprint rows (empty hash) always hold.
	if !reviewedMarkHolds(r.repo, "main", store.ReviewedFile{Path: "f.txt", ContentHash: ""}) {
		t.Error("empty-hash (legacy) mark should hold")
	}

	// A worktree mark holds while the on-disk content is unchanged, and drops once
	// it changes — the derive-don't-trust behavior.
	h := fileContentHash(r.repo, "main", "f.txt", true, false)
	mark := store.ReviewedFile{Path: "f.txt", ContentHash: h, Worktree: true}
	if !reviewedMarkHolds(r.repo, "main", mark) {
		t.Error("worktree mark should hold before any edit")
	}
	r.write("f.txt", "hello-edited\n")
	if reviewedMarkHolds(r.repo, "main", mark) {
		t.Error("worktree mark should drop after the file changes")
	}
}

// A reviewed deletion stores the absent sentinel: it holds while the file stays
// gone and reverts once the file reappears with content.
func TestReviewedMarkAbsentSentinel(t *testing.T) {
	r := newRepo(t)
	r.write("keep.txt", "x\n")
	r.commitAll("c1")

	mark := store.ReviewedFile{Path: "gone.txt", ContentHash: absentContentHash}
	if !reviewedMarkHolds(r.repo, "main", mark) {
		t.Error("absent mark should hold while the file is still missing")
	}
	r.write("gone.txt", "back\n") // file reappears on disk
	markWT := store.ReviewedFile{Path: "gone.txt", ContentHash: absentContentHash, Worktree: true}
	if reviewedMarkHolds(r.repo, "main", markWT) {
		t.Error("absent mark should drop once the file returns with content")
	}
}
