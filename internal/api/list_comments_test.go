package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"local-review/internal/store"
)

func listComments(t *testing.T, s *Server, id int64, author string) (int, []store.Comment, string) {
	t.Helper()
	url := "/"
	if author != "" {
		url += "?author=" + author
	}
	req := httptest.NewRequest(http.MethodGet, url, nil)
	req.SetPathValue("id", strconv.FormatInt(id, 10))
	rec := httptest.NewRecorder()
	s.handleListComments(rec, req)
	var body struct {
		Comments []store.Comment `json:"comments"`
	}
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode: %v", err)
		}
	}
	return rec.Code, body.Comments, rec.Body.String()
}

// GET /api/reviews/{id}/comments?author= narrows to one root author — the read
// side an adversarial-review agent uses to see only its own threads. Empty results
// must serialize as [] (the documented contract), never null.
func TestHandleListCommentsAuthorFilter(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "x\n")
	head := r.commitAll("c1")
	s := r.server()
	rev, err := s.Store.CreateOrGetReview(r.dir, "main", "main", head)
	if err != nil {
		t.Fatalf("CreateOrGetReview: %v", err)
	}
	// File-level (line-0) comments from three distinct identities.
	for _, author := range []string{"reviewer", "review-agent", "agent"} {
		if _, err := s.Store.AddComment(store.Comment{
			ReviewID: rev.ID, FilePath: "f.txt", StartLine: 0, EndLine: 0, Type: store.CommentNit, Body: "b", Author: author,
		}); err != nil {
			t.Fatalf("AddComment(%s): %v", author, err)
		}
	}

	if code, cs, _ := listComments(t, s, rev.ID, ""); code != http.StatusOK || len(cs) != 3 {
		t.Fatalf("no filter: code %d, %d comments, want 200/3", code, len(cs))
	}

	code, cs, _ := listComments(t, s, rev.ID, "review-agent")
	if code != http.StatusOK || len(cs) != 1 || cs[0].Author != "review-agent" {
		t.Fatalf("author=review-agent: code %d, comments %+v, want the single review-agent comment", code, cs)
	}

	code, cs, raw := listComments(t, s, rev.ID, "nobody")
	if code != http.StatusOK || len(cs) != 0 {
		t.Fatalf("author=nobody: code %d, %d comments, want 200/0", code, len(cs))
	}
	if !strings.Contains(raw, `"comments":[]`) {
		t.Errorf("empty result must be [] not null, got: %s", raw)
	}
}
