package store

import (
	"testing"
	"time"
)

// A distinctly-old timestamp so "was it bumped?" is decidable without depending on
// the 1-second granularity of nowStr / real-clock timing.
const oldTS = "2001-02-03T04:05:06Z"

func setUpdatedAt(t *testing.T, s *Store, table string, id int64, ts string) {
	t.Helper()
	// table is a test-controlled literal, never user input.
	if _, err := s.db.Exec("UPDATE "+table+" SET updated_at=? WHERE id=?", ts, id); err != nil {
		t.Fatalf("set updated_at: %v", err)
	}
}

func addReview(t *testing.T, s *Store) *Review {
	t.Helper()
	rev, err := s.CreateOrGetReview("/repo", "main", "feature", "sha1")
	if err != nil {
		t.Fatalf("CreateOrGetReview: %v", err)
	}
	return rev
}

func addComment(t *testing.T, s *Store, reviewID int64) *Comment {
	t.Helper()
	c, err := s.AddComment(Comment{ReviewID: reviewID, FilePath: "a.go", StartLine: 1, EndLine: 1, Type: CommentNit, Body: "x"})
	if err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	return c
}

// Resolving must NOT bump updated_at — that column drives the UI's "(edited)"
// marker, which tracks body/type edits only. This is an explicit invariant; a
// regression would light up "edited" on every resolve.
func TestSetCommentResolvedDoesNotBumpUpdatedAt(t *testing.T) {
	s := openTemp(t)
	rev := addReview(t, s)
	c := addComment(t, s, rev.ID)
	setUpdatedAt(t, s, "comments", c.ID, oldTS)

	rid, err := s.SetCommentResolved(c.ID, true)
	if err != nil {
		t.Fatalf("SetCommentResolved: %v", err)
	}
	if rid != rev.ID {
		t.Errorf("SetCommentResolved returned reviewID %d, want %d", rid, rev.ID)
	}

	var updated string
	var resolved int
	if err := s.db.QueryRow(`SELECT updated_at, resolved FROM comments WHERE id=?`, c.ID).Scan(&updated, &resolved); err != nil {
		t.Fatal(err)
	}
	if resolved != 1 {
		t.Errorf("resolved = %d, want 1", resolved)
	}
	if updated != oldTS {
		t.Errorf("updated_at = %q after resolve, want it unchanged (%q)", updated, oldTS)
	}
}

// Editing a comment's body/type/range DOES bump updated_at (contrast with resolve),
// and the fields are persisted.
func TestUpdateCommentBumpsUpdatedAtAndFields(t *testing.T) {
	s := openTemp(t)
	rev := addReview(t, s)
	c := addComment(t, s, rev.ID)
	setUpdatedAt(t, s, "comments", c.ID, oldTS)

	got, err := s.UpdateComment(c.ID, "new body", CommentBug, 5, 7)
	if err != nil {
		t.Fatalf("UpdateComment: %v", err)
	}
	if got.Body != "new body" || got.Type != CommentBug || got.StartLine != 5 || got.EndLine != 7 {
		t.Errorf("update not persisted: %+v", got)
	}

	var updated string
	if err := s.db.QueryRow(`SELECT updated_at FROM comments WHERE id=?`, c.ID).Scan(&updated); err != nil {
		t.Fatal(err)
	}
	if updated == oldTS {
		t.Error("updated_at should be bumped by an edit, but it was left unchanged")
	}
}

// The reviewed-file anchor side (worktree / index) and fingerprint must round-trip,
// the upsert must refresh a re-review in place (one row, new side + hash), and
// unmarking must delete — the batch is atomic per call.
func TestSetFilesReviewedRoundTripAndUpsert(t *testing.T) {
	s := openTemp(t)
	rev := addReview(t, s)

	// Mark on the index side.
	if err := s.SetFilesReviewed(rev.ID, []FileReviewMark{{Path: "a.txt", ContentHash: "h1"}}, true, false, true); err != nil {
		t.Fatalf("SetFilesReviewed(index): %v", err)
	}
	full, err := s.ListReviewedFilesFull(rev.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(full) != 1 {
		t.Fatalf("want 1 reviewed row, got %d", len(full))
	}
	if f := full[0]; f.Path != "a.txt" || f.ContentHash != "h1" || f.Worktree || !f.Indexed {
		t.Errorf("index-side row = %+v, want {a.txt h1 worktree=false indexed=true}", f)
	}

	// Re-review the same file on the worktree side: upsert in place (still one row),
	// with the side flipped and the fingerprint refreshed.
	if err := s.SetFilesReviewed(rev.ID, []FileReviewMark{{Path: "a.txt", ContentHash: "h2"}}, true, true, false); err != nil {
		t.Fatalf("SetFilesReviewed(re-review): %v", err)
	}
	full, _ = s.ListReviewedFilesFull(rev.ID)
	if len(full) != 1 {
		t.Fatalf("re-review should upsert, got %d rows", len(full))
	}
	if f := full[0]; f.ContentHash != "h2" || !f.Worktree || f.Indexed {
		t.Errorf("after re-review row = %+v, want {h2 worktree=true indexed=false}", f)
	}

	// Batch mark, then unmark a subset in one call → unmarked rows are deleted.
	if err := s.SetFilesReviewed(rev.ID, []FileReviewMark{{Path: "a.txt"}, {Path: "b.txt"}}, true, false, false); err != nil {
		t.Fatalf("batch mark: %v", err)
	}
	if err := s.SetFilesReviewed(rev.ID, []FileReviewMark{{Path: "a.txt"}}, false, false, false); err != nil {
		t.Fatalf("unmark: %v", err)
	}
	full, _ = s.ListReviewedFilesFull(rev.ID)
	if len(full) != 1 || full[0].Path != "b.txt" {
		t.Errorf("after unmarking a.txt, rows = %+v, want only b.txt", full)
	}
}

// Deleting a comment must cascade-delete its replies (they must never orphan).
func TestDeleteCommentCascadesReplies(t *testing.T) {
	s := openTemp(t)
	rev := addReview(t, s)
	c := addComment(t, s, rev.ID)
	for _, body := range []string{"r1", "r2"} {
		if _, _, err := s.AddReply(c.ID, body, "reviewer"); err != nil {
			t.Fatalf("AddReply: %v", err)
		}
	}

	rid, err := s.DeleteComment(c.ID)
	if err != nil {
		t.Fatalf("DeleteComment: %v", err)
	}
	if rid != rev.ID {
		t.Errorf("DeleteComment returned reviewID %d, want %d", rid, rev.ID)
	}
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM replies WHERE comment_id=?`, c.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("replies should cascade-delete with their comment, %d remain", n)
	}
}

// GetReview nests replies under their comment in creation order, preserving author.
func TestGetReviewNestsRepliesInOrder(t *testing.T) {
	s := openTemp(t)
	rev := addReview(t, s)
	c := addComment(t, s, rev.ID)
	if _, _, err := s.AddReply(c.ID, "first", "reviewer"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.AddReply(c.ID, "second", "agent"); err != nil {
		t.Fatal(err)
	}

	got, err := s.GetReview(rev.ID)
	if err != nil {
		t.Fatalf("GetReview: %v", err)
	}
	if len(got.Comments) != 1 {
		t.Fatalf("want 1 comment, got %d", len(got.Comments))
	}
	rs := got.Comments[0].Replies
	if len(rs) != 2 {
		t.Fatalf("want 2 replies, got %d", len(rs))
	}
	if rs[0].Body != "first" || rs[0].Author != "reviewer" || rs[1].Body != "second" || rs[1].Author != "agent" {
		t.Errorf("replies out of order or authors lost: %+v", rs)
	}
}

// A review resumes by (repo, base, head) regardless of status, so exporting it and
// then re-opening the branch returns the SAME row with its comments intact — never
// a fresh duplicate.
func TestCreateOrGetReviewResumesAfterExport(t *testing.T) {
	s := openTemp(t)
	rev := addReview(t, s)
	addComment(t, s, rev.ID)
	if err := s.SetStatus(rev.ID, StatusExported); err != nil {
		t.Fatalf("SetStatus: %v", err)
	}

	again, err := s.CreateOrGetReview("/repo", "main", "feature", "sha2")
	if err != nil {
		t.Fatalf("CreateOrGetReview (resume): %v", err)
	}
	if again.ID != rev.ID {
		t.Fatalf("resume created a new review (id %d), want same id %d", again.ID, rev.ID)
	}
	if again.HeadSHA != "sha2" {
		t.Errorf("HeadSHA = %q, want it refreshed to sha2", again.HeadSHA)
	}
	if len(again.Comments) != 1 {
		t.Errorf("resumed review lost its comments: %d present, want 1", len(again.Comments))
	}
}

// ResetReview clears a review's comments and reviewed marks but keeps the review row
// itself, so the branch resumes empty rather than spawning a fresh review.
func TestResetReviewClearsButKeepsReview(t *testing.T) {
	s := openTemp(t)
	rev := addReview(t, s)
	addComment(t, s, rev.ID)
	if err := s.SetFilesReviewed(rev.ID, []FileReviewMark{{Path: "a.txt", ContentHash: "h"}}, true, false, false); err != nil {
		t.Fatal(err)
	}

	if err := s.ResetReview(rev.ID); err != nil {
		t.Fatalf("ResetReview: %v", err)
	}
	got, err := s.GetReview(rev.ID)
	if err != nil {
		t.Fatalf("review row should survive reset: %v", err)
	}
	if len(got.Comments) != 0 || len(got.ReviewedFiles) != 0 {
		t.Errorf("reset left %d comments / %d reviewed files, want 0/0", len(got.Comments), len(got.ReviewedFiles))
	}
}

// PruneDrafts removes only stale drafts: recent drafts and exported reviews (at any
// age) are kept — losing an exported review's work would be the real bug.
func TestPruneDraftsKeepsRecentAndExported(t *testing.T) {
	s := openTemp(t)
	staleDraft := addReview(t, s) // (repo, main, feature)

	recentDraft, err := s.CreateOrGetReview("/repo", "main", "recent", "sha")
	if err != nil {
		t.Fatal(err)
	}
	oldExported, err := s.CreateOrGetReview("/repo", "main", "exported", "sha")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetStatus(oldExported.ID, StatusExported); err != nil {
		t.Fatal(err)
	}

	old := time.Now().UTC().Add(-48 * time.Hour).Format(timeFmt)
	setUpdatedAt(t, s, "reviews", staleDraft.ID, old)
	setUpdatedAt(t, s, "reviews", oldExported.ID, old)

	n, err := s.PruneDrafts(24 * time.Hour)
	if err != nil {
		t.Fatalf("PruneDrafts: %v", err)
	}
	if n != 1 {
		t.Errorf("pruned %d reviews, want 1 (only the stale draft)", n)
	}
	if _, err := s.GetReview(staleDraft.ID); err == nil {
		t.Error("stale draft should have been pruned")
	}
	if _, err := s.GetReview(recentDraft.ID); err != nil {
		t.Errorf("recent draft should be kept: %v", err)
	}
	if _, err := s.GetReview(oldExported.ID); err != nil {
		t.Errorf("old exported review should be kept: %v", err)
	}
}
