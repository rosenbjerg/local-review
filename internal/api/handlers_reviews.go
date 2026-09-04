// Review-level endpoints: create/resume, read, reset, delete, the free-text
// summary, the reviewed-file marks, and the markdown export.
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
	// Store the main branch name (readable in the export); the diff endpoint resolves
	// it to the merge-base with head at query time. Fall back to the main branch when
	// none is given or the given one no longer resolves, so a stale base isn't stored.
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
	// Probe the merge-base the diff will need, so a base that can't be compared to
	// head fails here rather than after a review row exists. Without it the reviewer
	// lands holding a review, an empty file list and an error about neither.
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
	s.annotateReview(review)
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

// safeBaseURL turns the request Host into the base URL embedded in the exported
// curl instructions. The Host is client-controlled and Go's server accepts spaces,
// semicolons, and backticks in it, so a crafted value would inject shell into a
// snippet a coding agent might run; anything outside a hostname/IP[:port] charset
// falls back to the loopback default rather than being echoed verbatim.
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

// The export has two shapes over one rendering. The browser wants JSON: it renders
// the markdown in a preview and needs the download filename alongside it. An agent
// wants the markdown itself — digging it out of a JSON envelope costs a `jq` the
// copyable prompt shouldn't assume is installed, and that pipeline's failure mode is
// the first instruction in the prompt not working. Both run the same render and the
// same status transition; only the envelope differs.
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

// The `.md` variant: the markdown as the body, so reading a review is one `curl -s`
// with nothing to parse. The filename rides in Content-Disposition, the only place
// left to carry it once the envelope is gone (`curl -OJ` picks it up), and stays
// `inline` so a client that displays the response doesn't turn it into a download.
// Errors stay JSON, like every other endpoint's — a 404 here is read by the same
// clients and logged by the same wrapper.
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
	// Capture the fingerprint of each file's on-screen side — dropped later if the
	// content changes (see reviewed.go). A folder-level toggle arrives as one batch,
	// so the reads are warmed in a single git command rather than one per file.
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
