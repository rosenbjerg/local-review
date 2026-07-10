// Package api wires the HTTP handlers over the git service and store.
package api

import (
	"encoding/json"
	"fmt"
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
	Root  string // folder containing one or more git repositories
	Store *store.Store
	hub   *hub // fans review-change pings out to connected SSE clients
}

func New(root string, st *store.Store) *Server {
	return &Server{Root: root, Store: st, hub: newHub()}
}

// isGitRepo reports whether path is a git working tree (has a .git entry).
func isGitRepo(path string) bool {
	_, err := os.Stat(filepath.Join(path, ".git"))
	return err == nil
}

// listRepos returns the names of git repositories directly under the root.
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

// repoFor resolves a client-supplied repo name to a Repo, rejecting anything
// that isn't a single path segment naming a git repo under the root (guards
// against path traversal).
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

// repoParam resolves the ?repo= query parameter, writing an error response on
// failure.
func (s *Server) repoParam(w http.ResponseWriter, r *http.Request) (*git.Repo, bool) {
	repo, err := s.repoFor(r.URL.Query().Get("repo"))
	if err != nil {
		httpError(w, http.StatusBadRequest, err)
		return nil, false
	}
	return repo, true
}

// Routes registers all API handlers on the given mux.
func (s *Server) Routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/repos", s.handleRepos)
	mux.HandleFunc("GET /api/branches", s.handleBranches)
	mux.HandleFunc("GET /api/diff", s.handleDiff)
	mux.HandleFunc("GET /api/file", s.handleFile)

	mux.HandleFunc("POST /api/reviews", s.handleCreateReview)
	mux.HandleFunc("GET /api/reviews", s.handleListReviews)
	mux.HandleFunc("GET /api/reviews/{id}", s.handleGetReview)
	mux.HandleFunc("GET /api/reviews/{id}/events", s.handleEvents)
	mux.HandleFunc("DELETE /api/reviews/{id}", s.handleDeleteReview)
	mux.HandleFunc("POST /api/reviews/{id}/export", s.handleExport)
	mux.HandleFunc("POST /api/reviews/{id}/reviewed", s.handleSetReviewed)

	mux.HandleFunc("POST /api/reviews/{id}/comments", s.handleAddComment)
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
	// Resolve base to its merge-base with head so the review shows only what
	// head introduces. Default to the main branch when no base is given.
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
	// When uncommitted is set, diff base against the working tree (committed +
	// staged + unstaged tracked changes) instead of the head commit.
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

func (s *Server) handleFile(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.repoParam(w, r)
	if !ok {
		return
	}
	path := r.URL.Query().Get("path")
	ref := r.URL.Query().Get("ref")
	if path == "" {
		httpError(w, http.StatusBadRequest, errString("path is required"))
		return
	}
	// worktree reads the on-disk (uncommitted) new side, which git show can't
	// reach — e.g. a new file that isn't committed at the head ref.
	var content string
	var err error
	if r.URL.Query().Get("worktree") == "true" {
		content, err = repo.WorktreeFile(path)
	} else {
		if err = validRef(ref); err != nil {
			httpError(w, http.StatusBadRequest, err)
			return
		}
		content, err = repo.FileContent(ref, path)
	}
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, map[string]any{"path": path, "ref": ref, "content": content})
}

// --- reviews ---

type createReviewReq struct {
	Repo string `json:"repo"`
	Base string `json:"base"`
	Head string `json:"head"`
}

func (s *Server) handleCreateReview(w http.ResponseWriter, r *http.Request) {
	var req createReviewReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpError(w, http.StatusBadRequest, err)
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
		// Store the main branch name (readable in the export). The diff
		// endpoint resolves it to the merge-base with head at query time,
		// so the review still shows only what head introduces.
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

// handleEvents streams review-change notifications to the client over SSE. It
// emits a "changed" event whenever a comment or reviewed-file of this review is
// mutated (by any tab); the client responds by refetching the review. Keepalive
// comments keep the stream warm and surface a half-open connection as a write
// error, so an unclean disconnect still unsubscribes and prunes the hub entry.
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

	// Prompt the client's onopen and flush headers through any dev proxy.
	if _, err := fmt.Fprint(w, ": connected\n\n"); err != nil {
		return
	}
	flusher.Flush()

	keepalive := time.NewTicker(25 * time.Second)
	defer keepalive.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done(): // tab closed / clean disconnect
			return
		case <-ch:
			if _, err := fmt.Fprint(w, "data: changed\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case <-keepalive.C:
			// Comment line (never triggers EventSource.onmessage). Forces a
			// write on an idle stream so a dead connection errors out here.
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
	s.hub.publish(id)
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
	Author    string `json:"author"`
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
	if req.Author == "" {
		// An omitted author means an API client that doesn't set the field —
		// in practice the coding agent. The browser app sends "reviewer".
		req.Author = "agent"
	}
	// Record which head commit this comment anchors to. Best-effort: a comment
	// is still valid if the repo can't be reached, so failures leave it empty.
	var repo *git.Repo
	var headRef, sha string
	if repoPath, hr, err := s.Store.ReviewRepoHead(id); err == nil {
		repo, headRef = git.New(repoPath), hr
		sha, _ = repo.ResolveSHA(hr)
	}
	c, err := s.Store.AddComment(store.Comment{
		ReviewID:  id,
		FilePath:  req.FilePath,
		StartLine: req.StartLine,
		EndLine:   req.EndLine,
		Snippet:   req.Snippet,
		Type:      req.Type,
		Body:      req.Body,
		Author:    req.Author,
		CommitSHA: sha,
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
	_ = s.Store.Touch(id)
	s.hub.publish(id)
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
	s.hub.publish(c.ReviewID)
	writeJSON(w, c)
}

func (s *Server) handleDeleteComment(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	reviewID, err := s.Store.DeleteComment(id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	s.hub.publish(reviewID)
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
	var req setResolvedReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	reviewID, err := s.Store.SetCommentResolved(id, req.Resolved)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	_ = s.Store.Touch(reviewID)
	s.hub.publish(reviewID)
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
	var req replyReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	if req.Author == "" {
		// An omitted author means an API client that doesn't set the field —
		// in practice the coding agent. The browser app sends "reviewer".
		req.Author = "agent"
	}
	rep, reviewID, err := s.Store.AddReply(commentID, req.Body, req.Author)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	_ = s.Store.Touch(reviewID)
	s.hub.publish(reviewID)
	writeJSON(w, rep)
}

func (s *Server) handleUpdateReply(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req replyReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	rep, reviewID, err := s.Store.UpdateReply(id, req.Body)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	s.hub.publish(reviewID)
	writeJSON(w, rep)
}

func (s *Server) handleDeleteReply(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	reviewID, err := s.Store.DeleteReply(id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	s.hub.publish(reviewID)
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

// validRef rejects empty refs and refs git would treat as an option (leading
// "-"). Legitimate git ref names never start with "-", so this is safe and
// prevents a client-supplied ref like "--output=/path" from becoming a git flag.
func validRef(ref string) error {
	if ref == "" {
		return errString("empty ref")
	}
	if strings.HasPrefix(ref, "-") {
		return errString("invalid ref")
	}
	return nil
}

func sanitize(s string) string {
	return strings.NewReplacer("/", "-", " ", "-", ":", "-").Replace(s)
}
