package api

import (
	"os"
	"testing"

	"local-review/internal/store"
)

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
