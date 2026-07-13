// Package api wires the HTTP handlers over the git service and store.
package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"local-review/internal/export"
	"local-review/internal/git"
	"local-review/internal/store"
)

type Server struct {
	Root  string
	Store *store.Store
	hub   *hub
}

func New(root string, st *store.Store) *Server {
	return &Server{Root: root, Store: st, hub: newHub()}
}

func isGitRepo(path string) bool {
	_, err := os.Stat(filepath.Join(path, ".git"))
	return err == nil
}

func (s *Server) listRepos() ([]string, error) {
	entries, err := os.ReadDir(s.Root)
	if err != nil {
		return nil, err
	}
	repos := []string{}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		if isGitRepo(filepath.Join(s.Root, e.Name())) {
			repos = append(repos, e.Name())
		}
	}
	return repos, nil
}

// Rejects anything that isn't a single path segment under the root — a
// path-traversal guard, so keep the segment check if you touch this.
func (s *Server) repoFor(name string) (*git.Repo, error) {
	if name == "" {
		return nil, errString("repo is required")
	}
	if name != filepath.Base(name) || name == "." || name == ".." || strings.ContainsAny(name, `/\`) {
		return nil, errString("invalid repo name")
	}
	abs := filepath.Join(s.Root, name)
	if !isGitRepo(abs) {
		return nil, errString("not a git repository: " + name)
	}
	return git.New(abs), nil
}

func (s *Server) repoParam(w http.ResponseWriter, r *http.Request) (*git.Repo, bool) {
	repo, err := s.repoFor(r.URL.Query().Get("repo"))
	if err != nil {
		httpError(w, http.StatusBadRequest, err)
		return nil, false
	}
	return repo, true
}

func (s *Server) Routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/repos", s.handleRepos)
	mux.HandleFunc("GET /api/branches", s.handleBranches)
	mux.HandleFunc("GET /api/diff", s.handleDiff)
	mux.HandleFunc("GET /api/files", s.handleFiles)
	mux.HandleFunc("GET /api/file", s.handleFile)
	mux.HandleFunc("GET /api/blob", s.handleBlob)

	mux.HandleFunc("POST /api/reviews", s.handleCreateReview)
	mux.HandleFunc("GET /api/reviews", s.handleListReviews)
	mux.HandleFunc("GET /api/reviews/{id}", s.handleGetReview)
	mux.HandleFunc("GET /api/reviews/{id}/events", s.handleEvents)
	mux.HandleFunc("DELETE /api/reviews/{id}", s.handleDeleteReview)
	mux.HandleFunc("POST /api/reviews/{id}/export", s.handleExport)
	mux.HandleFunc("POST /api/reviews/{id}/reset", s.handleResetReview)
	mux.HandleFunc("POST /api/reviews/{id}/reviewed", s.handleSetReviewed)

	mux.HandleFunc("POST /api/reviews/{id}/comments", s.handleAddComment)
	mux.HandleFunc("GET /api/reviews/{id}/comments", s.handleListComments)
	mux.HandleFunc("PATCH /api/comments/{id}", s.handleUpdateComment)
	mux.HandleFunc("DELETE /api/comments/{id}", s.handleDeleteComment)
	mux.HandleFunc("POST /api/comments/{id}/resolved", s.handleSetResolved)

	mux.HandleFunc("POST /api/comments/{id}/replies", s.handleAddReply)
	mux.HandleFunc("PATCH /api/replies/{id}", s.handleUpdateReply)
	mux.HandleFunc("DELETE /api/replies/{id}", s.handleDeleteReply)
}

// --- git-reading ---

func (s *Server) handleRepos(w http.ResponseWriter, r *http.Request) {
	repos, err := s.listRepos()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, map[string]any{"repos": repos})
}

func (s *Server) handleBranches(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.repoParam(w, r)
	if !ok {
		return
	}
	branches, err := repo.ListBranches()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, map[string]any{
		"branches": branches,
		"main":     repo.MainBranch(),
	})
}

func (s *Server) handleDiff(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.repoParam(w, r)
	if !ok {
		return
	}
	base := r.URL.Query().Get("base")
	head := r.URL.Query().Get("head")
	if err := validRef(head); err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	if base != "" {
		if err := validRef(base); err != nil {
			httpError(w, http.StatusBadRequest, err)
			return
		}
	}
	// Resolve base to its merge-base with head so the review shows only what head
	// introduces; default to the main branch when none is given.
	baseRef := base
	if baseRef == "" {
		baseRef = repo.MainBranch()
	}
	if baseRef == "" {
		httpError(w, http.StatusBadRequest, errString("no main or master branch found; select a base branch"))
		return
	}
	mb, err := repo.MergeBase(baseRef, head)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	base = mb
	uncommitted := r.URL.Query().Get("uncommitted") == "true"
	var diff []git.FileDiff
	if uncommitted {
		diff, err = repo.DiffWorktree(base)
	} else {
		diff, err = repo.Diff(base, head)
	}
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, map[string]any{"base": base, "head": head, "files": diff})
}

// handleFiles lists the tracked files at ref, feeding the picker that lets a
// reviewer comment on a file the branch didn't change.
func (s *Server) handleFiles(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.repoParam(w, r)
	if !ok {
		return
	}
	ref := r.URL.Query().Get("ref")
	if err := validRef(ref); err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	files, err := repo.ListFiles(ref)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, map[string]any{"files": files})
}

func (s *Server) readFileContent(w http.ResponseWriter, r *http.Request) (content, path string, ok bool) {
	repo, ok := s.repoParam(w, r)
	if !ok {
		return "", "", false
	}
	path = r.URL.Query().Get("path")
	if path == "" {
		httpError(w, http.StatusBadRequest, errString("path is required"))
		return "", "", false
	}
	var err error
	if r.URL.Query().Get("worktree") == "true" {
		// worktree reads the on-disk new side, which git show can't reach.
		content, err = repo.WorktreeFile(path)
	} else {
		ref := r.URL.Query().Get("ref")
		if err = validRef(ref); err != nil {
			httpError(w, http.StatusBadRequest, err)
			return "", "", false
		}
		content, err = repo.FileContent(ref, path)
		if err != nil {
			// The ref may lack the file (uncommitted new file, or a stale
			// mid-mode-switch request); serve the on-disk copy instead of failing.
			if wt, wtErr := repo.WorktreeFile(path); wtErr == nil {
				content, err = wt, nil
			}
		}
	}
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return "", "", false
	}
	return content, path, true
}

func (s *Server) handleFile(w http.ResponseWriter, r *http.Request) {
	content, path, ok := s.readFileContent(w, r)
	if !ok {
		return
	}
	writeJSON(w, map[string]any{"path": path, "ref": r.URL.Query().Get("ref"), "content": content})
}

func (s *Server) handleBlob(w http.ResponseWriter, r *http.Request) {
	content, path, ok := s.readFileContent(w, r)
	if !ok {
		return
	}
	w.Header().Set("Content-Type", mimeForPath(path))
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write([]byte(content))
}

func mimeForPath(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	case ".ico":
		return "image/x-icon"
	case ".avif":
		return "image/avif"
	case ".svg":
		return "image/svg+xml"
	}
	if t := mime.TypeByExtension(filepath.Ext(path)); t != "" {
		return t
	}
	return "application/octet-stream"
}

// --- reviews ---

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
	base := req.Base
	if base == "" {
		// Store the main branch name (readable in the export); the diff endpoint
		// resolves it to the merge-base with head at query time.
		base = repo.MainBranch()
	}
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

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpError(w, http.StatusInternalServerError, errString("streaming unsupported"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch := s.hub.subscribe(id)
	defer s.hub.unsubscribe(id, ch) // fires on every exit path — no orphaned channel

	if _, err := fmt.Fprint(w, ": connected\n\n"); err != nil {
		return
	}
	flusher.Flush()

	keepalive := time.NewTicker(25 * time.Second)
	defer keepalive.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ch:
			if _, err := fmt.Fprint(w, "data: changed\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case <-keepalive.C:
			// Comment line (no onmessage): forces a write on an idle stream so a
			// dead connection errors out here.
			if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
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
	s.annotateReview(review)
	instructions := r.URL.Query().Get("instructions") == "true"
	md := export.Render(review, instructions, "http://"+r.Host)
	_ = s.Store.SetStatus(id, store.StatusExported)

	shortSHA := review.HeadSHA
	if len(shortSHA) > 7 {
		shortSHA = shortSHA[:7]
	}
	filename := "code-review-" + sanitize(review.HeadRef) + "-" + shortSHA + ".md"
	writeJSON(w, map[string]any{"markdown": md, "filename": filename})
}

type setReviewedReq struct {
	FilePaths []string `json:"filePaths"` // one file, or every file under a folder
	Reviewed  bool     `json:"reviewed"`
	Worktree  bool     `json:"worktree"`
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
	// Capture the fingerprint of each file's on-screen side — dropped later if the
	// content changes (see reviewed.go).
	var repo *git.Repo
	var headRef string
	if req.Reviewed {
		if repoPath, hr, err := s.Store.ReviewRepoHead(id); err == nil {
			repo, headRef = git.New(repoPath), hr
		}
	}
	marks := make([]store.FileReviewMark, 0, len(req.FilePaths))
	for _, p := range req.FilePaths {
		if p == "" {
			continue
		}
		hash := ""
		if req.Reviewed && repo != nil {
			hash = fileContentHash(repo, headRef, p, req.Worktree)
		}
		marks = append(marks, store.FileReviewMark{Path: p, ContentHash: hash})
	}
	if len(marks) == 0 {
		httpError(w, http.StatusBadRequest, errString("filePaths is required"))
		return
	}
	if err := s.Store.SetFilesReviewed(id, marks, req.Reviewed, req.Worktree); err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	s.notify(id)
	w.WriteHeader(http.StatusNoContent)
}

// --- comments ---

type addCommentReq struct {
	FilePath  string            `json:"filePath"`
	StartLine int               `json:"startLine"`
	EndLine   int               `json:"endLine"`
	Type      store.CommentType `json:"type"`
	Body      string            `json:"body"`
	Author    string            `json:"author"`
	Worktree  bool              `json:"worktree"`
}

func (s *Server) handleAddComment(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	req, ok := decodeBody[addCommentReq](w, r)
	if !ok {
		return
	}
	if req.StartLine < 0 {
		httpError(w, http.StatusBadRequest, errString("startLine must be >= 0"))
		return
	}
	if req.EndLine < req.StartLine {
		req.EndLine = req.StartLine
	}
	if req.Type == "" {
		req.Type = store.CommentSuggestion
	}
	if !validCommentType(req.Type) {
		httpError(w, http.StatusBadRequest, errString("invalid comment type"))
		return
	}
	if req.Author == "" {
		// An omitted author is the coding agent addressing the review; the browser
		// sends "reviewer" and the adversarial reviewer sends "review-agent".
		req.Author = "agent"
	}
	var repo *git.Repo
	var headRef, sha string
	if repoPath, hr, err := s.Store.ReviewRepoHead(id); err == nil {
		repo, headRef = git.New(repoPath), hr
		sha, _ = repo.ResolveSHA(hr)
	}
	// Capture the snippet from the anchored lines ourselves rather than trust the
	// client's copy, so the browser and API agents alike only send the range and
	// the stored text always matches the file. Line-0 file comments stay empty.
	snippet := ""
	if req.StartLine > 0 {
		snippet = captureSnippet(repo, headRef, req.FilePath, req.StartLine, req.EndLine, req.Worktree)
	}
	c, err := s.Store.AddComment(store.Comment{
		ReviewID:  id,
		FilePath:  req.FilePath,
		StartLine: req.StartLine,
		EndLine:   req.EndLine,
		Snippet:   snippet,
		Type:      req.Type,
		Body:      req.Body,
		Author:    req.Author,
		CommitSHA: sha,
		Worktree:  req.Worktree,
	})
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	if repo != nil {
		cs := []store.Comment{*c}
		annotateComments(repo, headRef, cs)
		c = &cs[0]
	}
	s.notify(id)
	writeJSON(w, c)
}

func (s *Server) handleListComments(w http.ResponseWriter, r *http.Request) {
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
	comments := review.Comments
	if author := r.URL.Query().Get("author"); author != "" {
		filtered := make([]store.Comment, 0, len(comments))
		for _, c := range comments {
			if c.Author == author {
				filtered = append(filtered, c)
			}
		}
		comments = filtered
	}
	writeJSON(w, map[string]any{"comments": comments})
}

type updateCommentReq struct {
	Body      string            `json:"body"`
	Type      store.CommentType `json:"type"`
	StartLine int               `json:"startLine"`
	EndLine   int               `json:"endLine"`
}

func (s *Server) handleUpdateComment(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	req, ok := decodeBody[updateCommentReq](w, r)
	if !ok {
		return
	}
	if req.StartLine < 0 {
		httpError(w, http.StatusBadRequest, errString("startLine must be >= 0"))
		return
	}
	if req.EndLine < req.StartLine {
		req.EndLine = req.StartLine
	}
	if !validCommentType(req.Type) {
		httpError(w, http.StatusBadRequest, errString("invalid comment type"))
		return
	}
	c, err := s.Store.UpdateComment(id, req.Body, req.Type, req.StartLine, req.EndLine)
	if err != nil {
		storeError(w, err)
		return
	}
	s.notify(c.ReviewID)
	writeJSON(w, c)
}

func (s *Server) handleDeleteComment(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	reviewID, err := s.Store.DeleteComment(id)
	if err != nil {
		storeError(w, err)
		return
	}
	s.notify(reviewID)
	w.WriteHeader(http.StatusNoContent)
}

type setResolvedReq struct {
	Resolved bool `json:"resolved"`
}

func (s *Server) handleSetResolved(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	req, ok := decodeBody[setResolvedReq](w, r)
	if !ok {
		return
	}
	reviewID, err := s.Store.SetCommentResolved(id, req.Resolved)
	if err != nil {
		storeError(w, err)
		return
	}
	s.notify(reviewID)
	w.WriteHeader(http.StatusNoContent)
}

// --- replies ---

type replyReq struct {
	Body   string `json:"body"`
	Author string `json:"author"`
}

func (s *Server) handleAddReply(w http.ResponseWriter, r *http.Request) {
	commentID, ok := pathID(w, r)
	if !ok {
		return
	}
	req, ok := decodeBody[replyReq](w, r)
	if !ok {
		return
	}
	if req.Author == "" {
		// An omitted author is the coding agent addressing the review; the browser
		// sends "reviewer" and the adversarial reviewer sends "review-agent".
		req.Author = "agent"
	}
	rep, reviewID, err := s.Store.AddReply(commentID, req.Body, req.Author)
	if err != nil {
		storeError(w, err)
		return
	}
	s.notify(reviewID)
	writeJSON(w, rep)
}

func (s *Server) handleUpdateReply(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	req, ok := decodeBody[replyReq](w, r)
	if !ok {
		return
	}
	rep, reviewID, err := s.Store.UpdateReply(id, req.Body)
	if err != nil {
		storeError(w, err)
		return
	}
	s.notify(reviewID)
	writeJSON(w, rep)
}

func (s *Server) handleDeleteReply(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	reviewID, err := s.Store.DeleteReply(id)
	if err != nil {
		storeError(w, err)
		return
	}
	s.notify(reviewID)
	w.WriteHeader(http.StatusNoContent)
}

// --- helpers ---

// A Touch failure is non-fatal — the mutation already landed.
func (s *Server) notify(reviewID int64) {
	_ = s.Store.Touch(reviewID)
	s.hub.publish(reviewID)
}

func decodeBody[T any](w http.ResponseWriter, r *http.Request) (req T, ok bool) {
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpError(w, http.StatusBadRequest, err)
		return req, false
	}
	return req, true
}

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

func storeError(w http.ResponseWriter, err error) {
	if errors.Is(err, sql.ErrNoRows) {
		httpError(w, http.StatusNotFound, errString("not found"))
		return
	}
	httpError(w, http.StatusInternalServerError, err)
}

type errString string

func (e errString) Error() string { return string(e) }

// validRef rejects empty refs and refs starting with "-" (which git would treat
// as a flag, e.g. "--output=/path"); legitimate ref names never start with "-".
func validRef(ref string) error {
	if ref == "" {
		return errString("empty ref")
	}
	if strings.HasPrefix(ref, "-") {
		return errString("invalid ref")
	}
	return nil
}

func validCommentType(t store.CommentType) bool {
	switch t {
	case store.CommentBug, store.CommentSuggestion, store.CommentQuestion, store.CommentNit:
		return true
	}
	return false
}

func sanitize(s string) string {
	return strings.NewReplacer("/", "-", " ", "-", ":", "-").Replace(s)
}
