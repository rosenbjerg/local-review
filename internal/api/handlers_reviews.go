// Review-level endpoints: create/resume, read, reset, delete, summary, reviewed marks, export.
package api

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	"local-review/internal/export"
	"local-review/internal/git"
	"local-review/internal/store"
)

type createReviewReq struct {
	Repo string `json:"repo"`
	Base string `json:"base"`
	Head string `json:"head"`
}

func (s *Server) handleCreateReview(w http.ResponseWriter, r *http.Request) {
	req, ok := decodeBody[createReviewReq](w, r)
	if !ok {
		return
	}
	repo, err := s.repoFor(req.Repo)
	if err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	if err := validRef(req.Head); err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	if req.Base != "" {
		if err := validRef(req.Base); err != nil {
			httpError(w, http.StatusBadRequest, err)
			return
		}
	}
	// A base that no longer resolves falls back to the main branch, so a stale one isn't stored.
	base := resolveBase(repo, req.Base)
	if base == "" {
		httpError(w, http.StatusBadRequest, errString("no main or master branch found; select a base branch"))
		return
	}
	sha, err := repo.ResolveSHA(req.Head)
	if err != nil {
		httpError(w, http.StatusBadRequest, fmt.Errorf(
			"could not resolve branch %q — it may have been deleted, renamed, or is mid-rebase; reload to refresh the branch list", req.Head))
		return
	}
	// Probe the merge-base now, so an incomparable base fails before a review row exists.
	if _, err := repo.MergeBase(base, req.Head); err != nil {
		httpError(w, mergeBaseStatus(err), mergeBaseError(err, base, req.Head))
		return
	}
	review, err := s.Store.CreateOrGetReview(repo.Path, base, req.Head, sha)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	s.annotateReview(review)
	writeJSON(w, review)
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
	s.annotateReview(review)
	writeJSON(w, review)
}

func (s *Server) handleResetReview(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.Store.ResetReview(id); err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	s.notify(id)
	w.WriteHeader(http.StatusNoContent)
}

// safeBaseURL derives the exported curl URL from Host, which is client-controlled and
// could inject shell into a snippet an agent runs; odd characters fall back to loopback.
func safeBaseURL(host string) string {
	const fallback = "http://127.0.0.1:7777"
	if host == "" {
		return fallback
	}
	for _, c := range host {
		ok := c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' ||
			c == '.' || c == '-' || c == ':' || c == '[' || c == ']'
		if !ok {
			return fallback
		}
	}
	return "http://" + host
}

// renderExport is the one render (and status transition) behind both export shapes.
func (s *Server) renderExport(w http.ResponseWriter, r *http.Request) (md, filename string, ok bool) {
	id, ok := pathID(w, r)
	if !ok {
		return "", "", false
	}
	review, err := s.Store.GetReview(id)
	if err != nil {
		httpError(w, http.StatusNotFound, err)
		return "", "", false
	}
	s.annotateReview(review)
	instructions := r.URL.Query().Get("instructions") == "true"
	md = export.Render(review, instructions, safeBaseURL(r.Host))
	_ = s.Store.SetStatus(id, store.StatusExported)

	return md, "code-review-" + sanitize(review.HeadRef) + "-" + export.ShortSHA(review.HeadSHA) + ".md", true
}

func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	md, filename, ok := s.renderExport(w, r)
	if !ok {
		return
	}
	writeJSON(w, map[string]any{"markdown": md, "filename": filename})
}

// handleExportMarkdown serves the markdown as the body, filename in Content-Disposition; errors stay JSON.
func (s *Server) handleExportMarkdown(w http.ResponseWriter, r *http.Request) {
	md, filename, ok := s.renderExport(w, r)
	if !ok {
		return
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", `inline; filename="`+filename+`"`)
	_, _ = io.WriteString(w, md)
}

type setSummaryReq struct {
	Summary string `json:"summary"`
}

func (s *Server) handleSetSummary(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	req, ok := decodeBody[setSummaryReq](w, r)
	if !ok {
		return
	}
	if err := s.Store.SetReviewSummary(id, strings.TrimSpace(req.Summary)); err != nil {
		storeError(w, err)
		return
	}
	s.notify(id)
	w.WriteHeader(http.StatusNoContent)
}

type setReviewedReq struct {
	FilePaths []string `json:"filePaths"` // one file, or every file under a folder
	Reviewed  bool     `json:"reviewed"`
	Side      string   `json:"side"` // "" (head) | "head" | "worktree" | "index"
}

func (s *Server) handleSetReviewed(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	req, ok := decodeBody[setReviewedReq](w, r)
	if !ok {
		return
	}
	side, err := sideOf(req.Side)
	if err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	// Fingerprint the on-screen side (dropped later if the content changes), warmed as one batch.
	var cache *contentCache
	if req.Reviewed {
		if repoPath, hr, err := s.Store.ReviewRepoHead(id); err == nil {
			cache = newContentCache(git.New(repoPath), hr)
			cache.warm(req.FilePaths, side)
		}
	}
	marks := make([]store.FileReviewMark, 0, len(req.FilePaths))
	for _, p := range req.FilePaths {
		if p == "" {
			continue
		}
		hash := ""
		if req.Reviewed && cache != nil {
			hash = hashSide(cache, p, side)
		}
		marks = append(marks, store.FileReviewMark{Path: p, ContentHash: hash})
	}
	if len(marks) == 0 {
		httpError(w, http.StatusBadRequest, errString("filePaths is required"))
		return
	}
	if err := s.Store.SetFilesReviewed(id, marks, req.Reviewed, side); err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	s.notify(id)
	w.WriteHeader(http.StatusNoContent)
}
