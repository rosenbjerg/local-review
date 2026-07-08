// Package api wires the HTTP handlers over the git service and store.
package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"local-review/internal/export"
	"local-review/internal/git"
	"local-review/internal/store"
)

type Server struct {
	Repo  *git.Repo
	Store *store.Store
}

func New(repo *git.Repo, st *store.Store) *Server {
	return &Server{Repo: repo, Store: st}
}

// Routes registers all API handlers on the given mux.
func (s *Server) Routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/branches", s.handleBranches)
	mux.HandleFunc("GET /api/diff", s.handleDiff)
	mux.HandleFunc("GET /api/file", s.handleFile)

	mux.HandleFunc("POST /api/reviews", s.handleCreateReview)
	mux.HandleFunc("GET /api/reviews", s.handleListReviews)
	mux.HandleFunc("GET /api/reviews/{id}", s.handleGetReview)
	mux.HandleFunc("DELETE /api/reviews/{id}", s.handleDeleteReview)
	mux.HandleFunc("GET /api/reviews/{id}/export", s.handleExport)
	mux.HandleFunc("POST /api/reviews/{id}/reviewed", s.handleSetReviewed)

	mux.HandleFunc("POST /api/reviews/{id}/comments", s.handleAddComment)
	mux.HandleFunc("PATCH /api/comments/{id}", s.handleUpdateComment)
	mux.HandleFunc("DELETE /api/comments/{id}", s.handleDeleteComment)
}

// --- git-reading ---

func (s *Server) handleBranches(w http.ResponseWriter, r *http.Request) {
	branches, err := s.Repo.ListBranches()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, map[string]any{
		"branches": branches,
		"main":     s.Repo.MainBranch(),
	})
}

func (s *Server) handleDiff(w http.ResponseWriter, r *http.Request) {
	base := r.URL.Query().Get("base")
	head := r.URL.Query().Get("head")
	if head == "" {
		httpError(w, http.StatusBadRequest, errString("head is required"))
		return
	}
	if base == "" {
		mb, err := s.Repo.MergeBase(s.Repo.MainBranch(), head)
		if err != nil {
			httpError(w, http.StatusInternalServerError, err)
			return
		}
		base = mb
	} else if !looksLikeSHA(base) {
		// resolve a ref to its merge-base with head so we show only what head introduces
		mb, err := s.Repo.MergeBase(base, head)
		if err == nil {
			base = mb
		}
	}
	diff, err := s.Repo.Diff(base, head)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, map[string]any{"base": base, "head": head, "files": diff})
}

func (s *Server) handleFile(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	ref := r.URL.Query().Get("ref")
	if path == "" || ref == "" {
		httpError(w, http.StatusBadRequest, errString("path and ref are required"))
		return
	}
	content, err := s.Repo.FileContent(ref, path)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, map[string]any{"path": path, "ref": ref, "content": content})
}

// --- reviews ---

type createReviewReq struct {
	Base string `json:"base"`
	Head string `json:"head"`
}

func (s *Server) handleCreateReview(w http.ResponseWriter, r *http.Request) {
	var req createReviewReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	if req.Head == "" {
		httpError(w, http.StatusBadRequest, errString("head is required"))
		return
	}
	base := req.Base
	if base == "" {
		// Store the main branch name (readable in the export). The diff
		// endpoint resolves it to the merge-base with head at query time,
		// so the review still shows only what head introduces.
		base = s.Repo.MainBranch()
	}
	sha, err := s.Repo.ResolveSHA(req.Head)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	review, err := s.Store.CreateOrGetReview(s.Repo.Path, base, req.Head, sha)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, review)
}

func (s *Server) handleListReviews(w http.ResponseWriter, r *http.Request) {
	reviews, err := s.Store.ListReviews()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, map[string]any{"reviews": reviews})
}

func (s *Server) handleGetReview(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	review, err := s.Store.GetReview(id)
	if err != nil {
		httpError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, review)
}

func (s *Server) handleDeleteReview(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.Store.DeleteReview(id); err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	review, err := s.Store.GetReview(id)
	if err != nil {
		httpError(w, http.StatusNotFound, err)
		return
	}
	md := export.Render(review)
	_ = s.Store.SetStatus(id, "exported")

	shortSHA := review.HeadSHA
	if len(shortSHA) > 7 {
		shortSHA = shortSHA[:7]
	}
	filename := "code-review-" + sanitize(review.HeadRef) + "-" + shortSHA + ".md"
	writeJSON(w, map[string]any{"markdown": md, "filename": filename})
}

type setReviewedReq struct {
	FilePath string `json:"filePath"`
	Reviewed bool   `json:"reviewed"`
}

func (s *Server) handleSetReviewed(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req setReviewedReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	if req.FilePath == "" {
		httpError(w, http.StatusBadRequest, errString("filePath is required"))
		return
	}
	if err := s.Store.SetFileReviewed(id, req.FilePath, req.Reviewed); err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	_ = s.Store.Touch(id)
	w.WriteHeader(http.StatusNoContent)
}

// --- comments ---

type addCommentReq struct {
	FilePath  string `json:"filePath"`
	StartLine int    `json:"startLine"`
	EndLine   int    `json:"endLine"`
	Snippet   string `json:"snippet"`
	Type      string `json:"type"`
	Body      string `json:"body"`
}

func (s *Server) handleAddComment(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req addCommentReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	if req.EndLine < req.StartLine {
		req.EndLine = req.StartLine
	}
	if req.Type == "" {
		req.Type = "suggestion"
	}
	c, err := s.Store.AddComment(store.Comment{
		ReviewID:  id,
		FilePath:  req.FilePath,
		StartLine: req.StartLine,
		EndLine:   req.EndLine,
		Snippet:   req.Snippet,
		Type:      req.Type,
		Body:      req.Body,
	})
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	_ = s.Store.Touch(id)
	writeJSON(w, c)
}

type updateCommentReq struct {
	Body      string `json:"body"`
	Type      string `json:"type"`
	StartLine int    `json:"startLine"`
	EndLine   int    `json:"endLine"`
}

func (s *Server) handleUpdateComment(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req updateCommentReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	if req.EndLine < req.StartLine {
		req.EndLine = req.StartLine
	}
	c, err := s.Store.UpdateComment(id, req.Body, req.Type, req.StartLine, req.EndLine)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, c)
}

func (s *Server) handleDeleteComment(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.Store.DeleteComment(id); err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- helpers ---

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpError(w, http.StatusBadRequest, errString("invalid id"))
		return 0, false
	}
	return id, true
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func httpError(w http.ResponseWriter, code int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}

type errString string

func (e errString) Error() string { return string(e) }

func looksLikeSHA(s string) bool {
	if len(s) < 7 || len(s) > 40 {
		return false
	}
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

func sanitize(s string) string {
	return strings.NewReplacer("/", "-", " ", "-", ":", "-").Replace(s)
}
