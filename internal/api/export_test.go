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

// exportReq invokes an export handler with an optional query string, which is where
// the `instructions` flag lives.
func exportReq(t *testing.T, h http.HandlerFunc, id int64, query string) *httptest.ResponseRecorder {
	t.Helper()
	url := "/"
	if query != "" {
		url += "?" + query
	}
	req := httptest.NewRequest(http.MethodPost, url, nil)
	req.SetPathValue("id", strconv.FormatInt(id, 10))
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

// The two export shapes are one rendering, so the `.md` body must be exactly the
// markdown the JSON variant reports — that equivalence is the thing that could
// silently rot, since the browser only ever reads the JSON one. It also carries the
// filename the envelope would have, and honours `instructions` the same way.
func TestExportMarkdownMatchesJSON(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "one\ntwo\n")
	head := r.commitAll("c1")

	s := r.server()
	rev, err := s.Store.CreateOrGetReview(r.dir, "main", "main", head)
	if err != nil {
		t.Fatalf("CreateOrGetReview: %v", err)
	}
	if rec := postJSON(t, s.handleAddComment, rev.ID, map[string]any{
		"filePath": "f.txt", "startLine": 1, "endLine": 1,
		"type": "bug", "body": "off by one",
	}); rec.Code != http.StatusOK {
		t.Fatalf("handleAddComment status %d: %s", rec.Code, rec.Body.String())
	}

	rec := exportReq(t, s.handleExport, rev.ID, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("handleExport status %d: %s", rec.Code, rec.Body.String())
	}
	var env struct {
		Markdown string `json:"markdown"`
		Filename string `json:"filename"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode export envelope: %v", err)
	}
	if !strings.Contains(env.Markdown, "off by one") {
		t.Fatalf("JSON export is missing the comment: %s", env.Markdown)
	}

	md := exportReq(t, s.handleExportMarkdown, rev.ID, "")
	if md.Code != http.StatusOK {
		t.Fatalf("handleExportMarkdown status %d: %s", md.Code, md.Body.String())
	}
	if got := md.Body.String(); got != env.Markdown {
		t.Errorf("`.md` body and JSON markdown differ:\n%q\nvs\n%q", got, env.Markdown)
	}
	if got := md.Header().Get("Content-Type"); got != "text/markdown; charset=utf-8" {
		t.Errorf("Content-Type = %q, want text/markdown", got)
	}
	if got, want := md.Header().Get("Content-Disposition"), `inline; filename="`+env.Filename+`"`; got != want {
		t.Errorf("Content-Disposition = %q, want %q", got, want)
	}

	// The reply-instructions block is opt-in on both shapes.
	if strings.Contains(md.Body.String(), "curl") {
		t.Errorf("`.md` export carries reply instructions unasked:\n%s", md.Body.String())
	}
	withInstructions := exportReq(t, s.handleExportMarkdown, rev.ID, "instructions=true")
	if !strings.Contains(withInstructions.Body.String(), "curl") {
		t.Errorf("instructions=true did not add the reply instructions:\n%s", withInstructions.Body.String())
	}
}

// Exporting is what marks a review exported, whichever shape was asked for.
func TestExportMarkdownSetsStatus(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "one\n")
	head := r.commitAll("c1")

	s := r.server()
	rev, err := s.Store.CreateOrGetReview(r.dir, "main", "main", head)
	if err != nil {
		t.Fatalf("CreateOrGetReview: %v", err)
	}
	if rec := exportReq(t, s.handleExportMarkdown, rev.ID, ""); rec.Code != http.StatusOK {
		t.Fatalf("handleExportMarkdown status %d: %s", rec.Code, rec.Body.String())
	}
	if got := getReview(t, s, rev.ID).Status; got != store.StatusExported {
		t.Errorf("status after `.md` export = %q, want %q", got, store.StatusExported)
	}
}

// An error keeps the API's JSON error shape even on the markdown endpoint — the same
// clients read it and the same wrapper logs it.
func TestExportMarkdownUnknownReview(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "one\n")
	r.commitAll("c1")

	rec := exportReq(t, r.server().handleExportMarkdown, 9999, "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 for an unknown review", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Errorf("error Content-Type = %q, want application/json", got)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error body: %v", err)
	}
	if body["error"] == "" {
		t.Errorf("error body = %v, want an \"error\" message", body)
	}
}
