package api

import (
	"net/http"
	"testing"
)

// The summary is round-tripped through the store and served back on the review,
// and an empty body clears it — the field has to be erasable, not just settable.
func TestSetSummaryRoundTrip(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "one\n")
	head := r.commitAll("c1")

	s := r.server()
	rev, err := s.Store.CreateOrGetReview(r.dir, "main", "main", head)
	if err != nil {
		t.Fatalf("CreateOrGetReview: %v", err)
	}
	if rev.Summary != "" {
		t.Errorf("new review summary = %q, want empty", rev.Summary)
	}

	if rec := postJSON(t, s.handleSetSummary, rev.ID, map[string]any{
		"summary": "  The error handling needs a rethink.  ",
	}); rec.Code != http.StatusNoContent {
		t.Fatalf("handleSetSummary status %d: %s", rec.Code, rec.Body.String())
	}
	if got := getReview(t, s, rev.ID).Summary; got != "The error handling needs a rethink." {
		t.Errorf("summary = %q, want it stored trimmed", got)
	}

	if rec := postJSON(t, s.handleSetSummary, rev.ID, map[string]any{"summary": ""}); rec.Code != http.StatusNoContent {
		t.Fatalf("clearing: status %d: %s", rec.Code, rec.Body.String())
	}
	if got := getReview(t, s, rev.ID).Summary; got != "" {
		t.Errorf("summary after clearing = %q, want empty", got)
	}
}

// Reset means "start this review over", so the summary goes with the comments —
// otherwise the next pass inherits the last one's framing.
func TestResetClearsSummary(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "one\n")
	head := r.commitAll("c1")

	s := r.server()
	rev, err := s.Store.CreateOrGetReview(r.dir, "main", "main", head)
	if err != nil {
		t.Fatalf("CreateOrGetReview: %v", err)
	}
	if rec := postJSON(t, s.handleSetSummary, rev.ID, map[string]any{"summary": "framing"}); rec.Code != http.StatusNoContent {
		t.Fatalf("handleSetSummary status %d: %s", rec.Code, rec.Body.String())
	}

	if rec := postJSON(t, s.handleResetReview, rev.ID, map[string]any{}); rec.Code != http.StatusNoContent {
		t.Fatalf("handleResetReview status %d: %s", rec.Code, rec.Body.String())
	}
	if got := getReview(t, s, rev.ID).Summary; got != "" {
		t.Errorf("summary after reset = %q, want empty", got)
	}
}

func TestSetSummaryUnknownReview(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "one\n")
	r.commitAll("c1")

	rec := postJSON(t, r.server().handleSetSummary, 9999, map[string]any{"summary": "x"})
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 for an unknown review", rec.Code)
	}
}
