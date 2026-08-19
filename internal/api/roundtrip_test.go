package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"local-review/internal/store"
)

// postJSON invokes an {id}-path handler with a JSON body, setting the path value
// the way the router would.
func postJSON(t *testing.T, h http.HandlerFunc, id int64, body any) *httptest.ResponseRecorder {
	t.Helper()
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(b))
	req.SetPathValue("id", strconv.FormatInt(id, 10))
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

func getReview(t *testing.T, s *Server, id int64) store.Review {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.SetPathValue("id", strconv.FormatInt(id, 10))
	rec := httptest.NewRecorder()
	s.handleGetReview(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("handleGetReview status %d: %s", rec.Code, rec.Body.String())
	}
	var rv store.Review
	if err := json.Unmarshal(rec.Body.Bytes(), &rv); err != nil {
		t.Fatalf("decode review: %v", err)
	}
	return rv
}

func contains(xs []string, want string) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}
	return false
}

// End-to-end: adding a comment on the staged (index) side must capture its snippet
// from the index — not the working tree, not head, not a client copy — persist the
// index anchor, and track staleness against the index. Exercises handleAddComment →
// captureSnippet → AddComment(indexed) → scanComment → annotateComments as one path,
// so a break in any link (e.g. the `indexed` column not round-tripping, or a side
// read from the wrong place) fails here.
func TestCommentRoundTripStagedSide(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "l1\nl2\nl3\n")
	head := r.commitAll("c1")
	r.write("f.txt", "l1\nSTAGED\nl3\n")
	r.git("add", "f.txt")              // index line 2 == "STAGED"
	r.write("f.txt", "l1\nWORK\nl3\n") // worktree line 2 == "WORK"

	s := r.server()
	rev, err := s.Store.CreateOrGetReview(r.dir, "main", "main", head)
	if err != nil {
		t.Fatalf("CreateOrGetReview: %v", err)
	}

	rec := postJSON(t, s.handleAddComment, rev.ID, map[string]any{
		"filePath": "f.txt", "startLine": 2, "endLine": 2, "type": "bug", "body": "x", "indexed": true,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("handleAddComment status %d: %s", rec.Code, rec.Body.String())
	}
	var c store.Comment
	if err := json.Unmarshal(rec.Body.Bytes(), &c); err != nil {
		t.Fatalf("decode comment: %v", err)
	}
	if c.Snippet != "STAGED" {
		t.Errorf("captured snippet = %q, want %q (from the index, not worktree/head)", c.Snippet, "STAGED")
	}
	if !c.Indexed {
		t.Error("comment should persist the index anchor side")
	}
	if c.AnchorStatus != store.AnchorCurrent {
		t.Errorf("fresh comment anchorStatus = %q, want current", c.AnchorStatus)
	}

	// Re-staging a change to the anchored line makes the stored snippet stale on the
	// index side → outdated on the next read.
	r.write("f.txt", "l1\nSTAGED-CHANGED\nl3\n")
	r.git("add", "f.txt")
	rv := getReview(t, s, rev.ID)
	if len(rv.Comments) != 1 {
		t.Fatalf("want 1 comment, got %d", len(rv.Comments))
	}
	if rv.Comments[0].AnchorStatus != store.AnchorOutdated {
		t.Errorf("after re-staging: anchorStatus = %q, want outdated", rv.Comments[0].AnchorStatus)
	}
}

// End-to-end: a reviewed mark taken on the staged side must be fingerprinted against
// the index, so a working-tree-only edit leaves it reviewed while a re-stage drops
// it. Exercises handleSetReviewed → fileContentHash(index) → SetFilesReviewed(indexed)
// → annotateReviewedFiles. A regression where the side flag isn't persisted would
// wrongly drop the mark on the worktree edit.
func TestReviewedRoundTripStagedSide(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "l1\n")
	head := r.commitAll("c1")
	r.write("f.txt", "STAGED\n")
	r.git("add", "f.txt")
	r.write("f.txt", "WORK\n") // worktree differs from the index

	s := r.server()
	rev, err := s.Store.CreateOrGetReview(r.dir, "main", "main", head)
	if err != nil {
		t.Fatalf("CreateOrGetReview: %v", err)
	}

	rec := postJSON(t, s.handleSetReviewed, rev.ID, map[string]any{
		"filePaths": []string{"f.txt"}, "reviewed": true, "indexed": true,
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("handleSetReviewed status %d: %s", rec.Code, rec.Body.String())
	}
	if rv := getReview(t, s, rev.ID); !contains(rv.ReviewedFiles, "f.txt") {
		t.Fatalf("f.txt should be reviewed, got %v", rv.ReviewedFiles)
	}

	// Worktree-only edit: the index is unchanged, so an index-side mark must hold.
	r.write("f.txt", "WORK2\n")
	if rv := getReview(t, s, rev.ID); !contains(rv.ReviewedFiles, "f.txt") {
		t.Errorf("a worktree edit dropped an index-side reviewed mark: %v", rv.ReviewedFiles)
	}

	// Re-staging a change does drop it (the fingerprinted side moved).
	r.write("f.txt", "STAGED2\n")
	r.git("add", "f.txt")
	if rv := getReview(t, s, rev.ID); contains(rv.ReviewedFiles, "f.txt") {
		t.Errorf("re-staging should drop the reviewed mark: %v", rv.ReviewedFiles)
	}
}

// The write side must enforce the same path rule the read side does, and refuse a
// body with nothing in it. Both used to be accepted, and the export then rendered
// the result as a nonsense or empty "## " file heading — a thread that says nothing
// yet still counts toward the review.
func TestAddCommentRejectsUnusableInput(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "l1\nl2\n")
	head := r.commitAll("c1")
	s := r.server()
	rev, err := s.Store.CreateOrGetReview(r.dir, "main", "main", head)
	if err != nil {
		t.Fatalf("CreateOrGetReview: %v", err)
	}

	bad := []struct {
		name string
		body map[string]any
	}{
		{"traversal path", map[string]any{"filePath": "../../../../etc/passwd", "startLine": 1, "endLine": 1, "body": "x"}},
		{"empty path", map[string]any{"filePath": "", "startLine": 1, "endLine": 1, "body": "x"}},
		{"absolute path", map[string]any{"filePath": "/etc/passwd", "startLine": 1, "endLine": 1, "body": "x"}},
		{"dotgit path", map[string]any{"filePath": ".git/config", "startLine": 1, "endLine": 1, "body": "x"}},
		{"empty body", map[string]any{"filePath": "f.txt", "startLine": 1, "endLine": 1, "body": ""}},
		{"whitespace body", map[string]any{"filePath": "f.txt", "startLine": 1, "endLine": 1, "body": "  \n\t "}},
		{"both anchor sides", map[string]any{"filePath": "f.txt", "startLine": 1, "endLine": 1, "body": "x", "worktree": true, "indexed": true}},
	}
	for _, c := range bad {
		t.Run(c.name, func(t *testing.T) {
			rec := postJSON(t, s.handleAddComment, rev.ID, c.body)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400 (body: %s)", rec.Code, rec.Body.String())
			}
		})
	}

	// The guard must not narrow what's legitimate — including the line-0 file
	// comment, whose path is the *only* thing anchoring it.
	for _, ok := range []struct {
		name string
		body map[string]any
	}{
		{"line comment", map[string]any{"filePath": "f.txt", "startLine": 1, "endLine": 2, "body": "x"}},
		{"file comment", map[string]any{"filePath": "f.txt", "startLine": 0, "endLine": 0, "body": "whole file"}},
		{"nested path", map[string]any{"filePath": "dir/sub/f.txt", "startLine": 0, "endLine": 0, "body": "x"}},
	} {
		t.Run(ok.name, func(t *testing.T) {
			rec := postJSON(t, s.handleAddComment, rev.ID, ok.body)
			if rec.Code != http.StatusOK {
				t.Errorf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
			}
		})
	}
}

// A reply with no text is the same defect one level down: it renders in the export
// as an author line with nothing after it.
func TestReplyRejectsEmptyBody(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "l1\n")
	head := r.commitAll("c1")
	s := r.server()
	rev, err := s.Store.CreateOrGetReview(r.dir, "main", "main", head)
	if err != nil {
		t.Fatalf("CreateOrGetReview: %v", err)
	}
	c, err := s.Store.AddComment(store.Comment{ReviewID: rev.ID, FilePath: "f.txt", StartLine: 1, EndLine: 1, Body: "root"})
	if err != nil {
		t.Fatalf("AddComment: %v", err)
	}

	for _, body := range []string{"", "   "} {
		rec := postJSON(t, s.handleAddReply, c.ID, map[string]any{"body": body})
		if rec.Code != http.StatusBadRequest {
			t.Errorf("reply body %q: status = %d, want 400", body, rec.Code)
		}
	}
	if rec := postJSON(t, s.handleAddReply, c.ID, map[string]any{"body": "real"}); rec.Code != http.StatusOK {
		t.Errorf("valid reply: status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
}
