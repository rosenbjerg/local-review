package review

import (
	"testing"

	"local-review/internal/store"
)

// sideHash is fileContentHash's old shape: build the per-read cache these helpers
// now take, then hash one path on one side.
func sideHash(r *testRepo, headRef, path string, side store.Side) string {
	return hashSide(newContentCache(r.repo, headRef), path, side)
}

// hashSide must hash the content of the side it is given, so the same
// path yields distinct hashes for head / working tree / index when they differ.
func TestFileContentHashPerSide(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "head\n")
	r.commitAll("c1")
	r.write("f.txt", "staged\n")
	r.git("add", "f.txt")
	r.write("f.txt", "work\n") // unstaged on top

	cases := []struct {
		side store.Side
		want string
	}{
		{store.SideHead, hashOf("head\n")},
		{store.SideWorktree, hashOf("work\n")},
		{store.SideIndex, hashOf("staged\n")},
	}
	for _, c := range cases {
		if got := sideHash(r, "main", "f.txt", c.side); got != c.want {
			t.Errorf("hashSide[%s] = %q, want %q", c.side, got, c.want)
		}
	}
}

// An unreadable side (a file that doesn't exist there) hashes to the absent
// sentinel — not "" (which would pin a mark forever) and not a real hash.
func TestFileContentHashAbsentSentinel(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "x\n")
	r.commitAll("c1")

	if got := sideHash(r, "main", "gone.txt", store.SideHead); got != absentContentHash {
		t.Errorf("missing head file = %q, want %q", got, absentContentHash)
	}
	if got := sideHash(r, "main", "gone.txt", store.SideWorktree); got != absentContentHash {
		t.Errorf("missing worktree file = %q, want %q", got, absentContentHash)
	}
}

// markHolds builds a **fresh** cache per call, which is the production lifetime: one
// contentCache serves one review read, so content edited between reads is seen. A
// cache shared across these calls would memoise the pre-edit content and the
// drop-after-change assertions below would pass for the wrong reason.
func markHolds(r *testRepo, headRef string, f store.ReviewedFile) bool {
	return reviewedMarkHolds(newContentCache(r.repo, headRef), f)
}

func TestReviewedMarkHolds(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "hello\n")
	r.commitAll("c1")

	// Legacy pre-fingerprint rows (empty hash) always hold.
	if !markHolds(r, "main", store.ReviewedFile{Path: "f.txt", ContentHash: ""}) {
		t.Error("empty-hash (legacy) mark should hold")
	}

	// A worktree mark holds while the on-disk content is unchanged, and drops once
	// it changes — the derive-don't-trust behavior.
	h := sideHash(r, "main", "f.txt", store.SideWorktree)
	mark := store.ReviewedFile{Path: "f.txt", ContentHash: h, Side: store.SideWorktree}
	if !markHolds(r, "main", mark) {
		t.Error("worktree mark should hold before any edit")
	}
	r.write("f.txt", "hello-edited\n")
	if markHolds(r, "main", mark) {
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
	if !markHolds(r, "main", mark) {
		t.Error("absent mark should hold while the file is still missing")
	}
	r.write("gone.txt", "back\n") // file reappears on disk
	markWT := store.ReviewedFile{Path: "gone.txt", ContentHash: absentContentHash, Side: store.SideWorktree}
	if markHolds(r, "main", markWT) {
		t.Error("absent mark should drop once the file returns with content")
	}
}
