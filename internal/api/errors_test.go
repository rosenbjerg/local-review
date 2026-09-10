package api

import (
	"net/http"
	"testing"
)

// A dead database is the server's fault, not a missing review. Every review-shaped read
// used to map any GetReview failure to 404, so an unreadable store answered "not found"
// at a status that tells the client to stop retrying.
func TestReviewReadsReportStoreFailureAs500(t *testing.T) {
	r := newRepo(t)
	r.write("a.go", "package a\n")
	head := r.commitAll("init")
	s := r.server()

	rev, err := s.Store.CreateOrGetReview(r.dir, "main", "main", head)
	if err != nil {
		t.Fatalf("CreateOrGetReview: %v", err)
	}
	if err := s.Store.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	for name, h := range map[string]handlerFunc{
		"get review":    s.handleGetReview,
		"list comments": s.handleListComments,
		"export":        s.handleExport,
	} {
		rec := postJSON(t, h, rev.ID, nil)
		if rec.Code != http.StatusInternalServerError {
			t.Errorf("%s on a closed store = %d, want 500 (%s)", name, rec.Code, rec.Body.String())
		}
	}
}

// The same reads must still answer 404 for a review that genuinely isn't there.
func TestReviewReadsReportMissingRowAs404(t *testing.T) {
	s := newRepo(t).server()
	for name, h := range map[string]handlerFunc{
		"get review":    s.handleGetReview,
		"list comments": s.handleListComments,
		"export":        s.handleExport,
	} {
		rec := postJSON(t, h, 9999, nil)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s for an absent review = %d, want 404 (%s)", name, rec.Code, rec.Body.String())
		}
	}
}
