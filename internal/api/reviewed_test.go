package api

import (
	"os"
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

// Both staleness checks read absence as a change: a comment whose side won't open
// is "outdated", a reviewed file whose content won't hash reverts to unread. Moving
// the repo directory — an ordinary thing to do — made every one of those reads fail
// at once, so the whole review came back stale and unreviewed at HTTP 200 with
// nothing saying why. The state is only *derived*, so it healed when the repo came
// back, but in the meantime the display was confidently wrong.
func TestUnreadableRepoDoesNotMarkEverythingStale(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "l1\nl2\n")
	r.write("g.txt", "x\n")
	head := r.commitAll("c1")
	s := r.server()
	rev, err := s.Store.CreateOrGetReview(r.dir, "main", "main", head)
	if err != nil {
		t.Fatalf("CreateOrGetReview: %v", err)
	}
	if _, err := s.Store.AddComment(store.Comment{
		ReviewID: rev.ID, FilePath: "f.txt", StartLine: 1, EndLine: 1,
		Snippet: "l1", Body: "note", CommitSHA: head,
	}); err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	marks := []store.FileReviewMark{{Path: "g.txt", ContentHash: hashOf("x\n")}}
	if err := s.Store.SetFilesReviewed(rev.ID, marks, true, store.SideHead); err != nil {
		t.Fatalf("SetFilesReviewed: %v", err)
	}

	// Sanity: with the repo in place, the marks hold and the comment is current.
	if got := getReview(t, s, rev.ID); got.AnnotationError != "" ||
		len(got.ReviewedFiles) != 1 || got.Comments[0].AnchorStatus != store.AnchorCurrent {
		t.Fatalf("baseline wrong: err=%q reviewed=%v status=%q",
			got.AnnotationError, got.ReviewedFiles, got.Comments[0].AnchorStatus)
	}

	t.Run("repo moved away", func(t *testing.T) {
		moved := r.dir + "-moved"
		if err := os.Rename(r.dir, moved); err != nil {
			t.Fatal(err)
		}
		defer os.Rename(moved, r.dir)

		got := getReview(t, s, rev.ID)
		if got.AnnotationError == "" {
			t.Error("an unreadable repo must say so, not report the review as stale")
		}
		if len(got.ReviewedFiles) != 1 {
			t.Errorf("reviewed marks = %v, want them kept while unverifiable", got.ReviewedFiles)
		}
		if st := got.Comments[0].AnchorStatus; st == store.AnchorOutdated {
			t.Error("comment reported outdated because the repo was unreadable, not because it moved")
		}
	})

	// A head that won't resolve is the same defect wearing a different hat.
	t.Run("head branch deleted", func(t *testing.T) {
		r.git("checkout", "-q", "-b", "other")
		r.git("branch", "-qD", "main")
		defer func() {
			r.git("checkout", "-q", "-b", "main")
			r.git("branch", "-qD", "other")
		}()

		got := getReview(t, s, rev.ID)
		if got.AnnotationError == "" {
			t.Error("a head that no longer resolves must say so")
		}
		if len(got.ReviewedFiles) != 1 {
			t.Errorf("reviewed marks = %v, want them kept", got.ReviewedFiles)
		}
	})

	// And it heals: the banner is derived per read, so it clears on its own.
	if got := getReview(t, s, rev.ID); got.AnnotationError != "" {
		t.Errorf("annotationError = %q, want cleared once the repo is readable again", got.AnnotationError)
	}
}
