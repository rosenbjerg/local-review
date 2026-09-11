// Review-level endpoints: create/resume, read, reset, summary, reviewed marks, export.
package api

import (
	"io"
	"net/http"
	"strings"

	"local-review/internal/export"
	"local-review/internal/review"
	"local-review/internal/store"
)

type createReviewReq struct {
	Repo string `json:"repo"`
	Base string `json:"base"`
	Head string `json:"head"`
}

func (s *Server) handleCreateReview(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeBody[createReviewReq](w, r)
	if err != nil {
		return err
	}
	repo, err := s.repos.Open(req.Repo)
	if err != nil {
		return badRequest(err)
	}
	if err := validRef(req.Head); err != nil {
		return err
	}
	if err := optionalRef(req.Base); err != nil {
		return err
	}
	// A base that no longer resolves falls back to the main branch, so a stale one isn't stored.
	base, err := resolveBaseRef(repo, req.Base)
	if err != nil {
		return err
	}
	sha, err := repo.ResolveSHA(req.Head)
	if err != nil {
		return badRequestf(
			"could not resolve branch %q — it may have been deleted, renamed, or is mid-rebase; reload to refresh the branch list", req.Head)
	}
	// Probe the merge-base now, so an incomparable base fails before a review row exists.
	if _, err := repo.MergeBase(base, req.Head); err != nil {
		return mergeBaseError(err, base, req.Head)
	}
	rev, err := s.Store.CreateOrGetReview(repo.Path, base, req.Head, sha)
	if err != nil {
		return err
	}
	s.annotateReview(rev)
	return writeJSON(w, rev)
}

func (s *Server) handleGetReview(w http.ResponseWriter, r *http.Request) error {
	rev, err := s.loadAnnotatedReview(r)
	if err != nil {
		return err
	}
	return writeJSON(w, rev)
}

// loadAnnotatedReview is the read every review-shaped endpoint starts from.
func (s *Server) loadAnnotatedReview(r *http.Request) (*store.Review, error) {
	id, err := pathID(r)
	if err != nil {
		return nil, err
	}
	rev, err := s.Store.GetReview(id)
	if err != nil {
		return nil, storeErr(err)
	}
	s.annotateReview(rev)
	return rev, nil
}

func (s *Server) handleResetReview(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	if err := s.Store.ResetReview(id); err != nil {
		return err
	}
	s.notify(id)
	return noContent(w)
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
func (s *Server) renderExport(r *http.Request) (md, filename string, err error) {
	rev, err := s.loadAnnotatedReview(r)
	if err != nil {
		return "", "", err
	}
	instructions := r.URL.Query().Get("instructions") == "true"
	md = export.Render(rev, instructions, safeBaseURL(r.Host))
	_ = s.Store.SetStatus(rev.ID, store.StatusExported)

	return md, "code-review-" + sanitize(rev.HeadRef) + "-" + export.ShortSHA(rev.HeadSHA) + ".md", nil
}

func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) error {
	md, filename, err := s.renderExport(r)
	if err != nil {
		return err
	}
	return writeJSON(w, map[string]any{"markdown": md, "filename": filename})
}

// handleExportMarkdown serves the markdown as the body, filename in Content-Disposition; errors stay JSON.
func (s *Server) handleExportMarkdown(w http.ResponseWriter, r *http.Request) error {
	md, filename, err := s.renderExport(r)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", `inline; filename="`+filename+`"`)
	_, _ = io.WriteString(w, md)
	return nil
}

type setSummaryReq struct {
	Summary string `json:"summary"`
}

func (s *Server) handleSetSummary(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	req, err := decodeBody[setSummaryReq](w, r)
	if err != nil {
		return err
	}
	if err := s.Store.SetReviewSummary(id, strings.TrimSpace(req.Summary)); err != nil {
		return storeErr(err)
	}
	s.notify(id)
	return noContent(w)
}

type setReviewedReq struct {
	FilePaths []string `json:"filePaths"` // one file, or every file under a folder
	Reviewed  bool     `json:"reviewed"`
	Side      string   `json:"side"` // "" (head) | "head" | "worktree" | "index"
}

func (s *Server) handleSetReviewed(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	req, err := decodeBody[setReviewedReq](w, r)
	if err != nil {
		return err
	}
	side, err := sideOf(req.Side)
	if err != nil {
		return err
	}
	// Fingerprint the on-screen side (dropped later if the content changes), warmed as one
	// batch. Not best-effort: an empty hash reads as a legacy row that always holds, so a
	// mark stored without one could never go stale again.
	var hashes map[string]string
	if req.Reviewed {
		repo, headRef, err := s.reviewRepo(id)
		if err != nil {
			return err
		}
		hashes = review.FingerprintFiles(repo, headRef, req.FilePaths, side)
	}
	marks := make([]store.FileReviewMark, 0, len(req.FilePaths))
	for _, p := range req.FilePaths {
		if p == "" {
			continue
		}
		marks = append(marks, store.FileReviewMark{Path: p, ContentHash: hashes[p]})
	}
	if len(marks) == 0 {
		return badRequest(errString("filePaths is required"))
	}
	if err := s.Store.SetFilesReviewed(id, marks, req.Reviewed, side); err != nil {
		return err
	}
	s.notify(id)
	return noContent(w)
}
