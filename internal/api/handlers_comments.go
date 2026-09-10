// Comment and reply endpoints: a comment is a thread root carrying the anchor, a reply is body-only.
package api

import (
	"net/http"

	"local-review/internal/git"
	"local-review/internal/store"
)

type addCommentReq struct {
	FilePath  string            `json:"filePath"`
	StartLine int               `json:"startLine"`
	EndLine   int               `json:"endLine"`
	Type      store.CommentType `json:"type"`
	Body      string            `json:"body"`
	Author    string            `json:"author"`
	// Omitted is the head side, which is what an API agent commenting on committed code wants.
	Side string `json:"side"` // "" (head) | "head" | "worktree" | "index"
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
	// The store accepts any string, so the read endpoints' path rule has to apply here too.
	if err := validPath(req.FilePath); err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	if err := validBody(req.Body); err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	side, err := sideOf(req.Side)
	if err != nil {
		httpError(w, http.StatusBadRequest, err)
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
		// An omitted author is the coding agent; the browser sends "reviewer".
		req.Author = "agent"
	}
	repoPath, headRef, err := s.Store.ReviewRepoHead(id)
	if err != nil {
		storeError(w, err)
		return
	}
	repo := git.New(repoPath)
	sha, _ := repo.ResolveSHA(headRef)
	// Captured server-side so the stored text always matches the file; line-0 file comments stay empty.
	snippet := ""
	if req.StartLine > 0 {
		snippet = captureSnippet(repo, headRef, req.FilePath, req.StartLine, req.EndLine, side)
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
		Side:      side,
	})
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	c = annotatedComment(repo, headRef, c)
	s.notify(id)
	writeJSON(w, c)
}

// annotatedComment recomputes one comment's anchor for a handler's response, so a client that
// swaps the returned comment into its list sees the same staleness a review read reports.
// One comment, so a cache warm-up would cost more than it saves.
func annotatedComment(repo *git.Repo, headRef string, c *store.Comment) *store.Comment {
	if repo == nil {
		return c
	}
	cs := []store.Comment{*c}
	annotateComments(repo, headRef, cs, newContentCache(repo, headRef))
	return &cs[0]
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
	if err := validBody(req.Body); err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	if req.EndLine < req.StartLine {
		req.EndLine = req.StartLine
	}
	if !validCommentType(req.Type) {
		httpError(w, http.StatusBadRequest, errString("invalid comment type"))
		return
	}
	existing, err := s.Store.GetComment(id)
	if err != nil {
		storeError(w, err)
		return
	}
	var repo *git.Repo
	var headRef string
	if repoPath, hr, err := s.Store.ReviewRepoHead(existing.ReviewID); err == nil {
		repo, headRef = git.New(repoPath), hr
	}
	snippet := existing.Snippet
	commitSHA := existing.CommitSHA
	// Only a request that actually moves the range re-anchors: the browser resends the stored
	// lines when editing a body, and re-capturing there would reset a moved comment to current.
	if req.StartLine != existing.StartLine || req.EndLine != existing.EndLine {
		snippet = ""
		if req.StartLine > 0 && repo != nil {
			snippet = captureSnippet(repo, headRef, existing.FilePath, req.StartLine, req.EndLine, existing.Side)
			if sha, err := repo.ResolveSHA(headRef); err == nil {
				commitSHA = sha
			}
		}
	}
	c, err := s.Store.UpdateComment(id, req.Body, req.Type, req.StartLine, req.EndLine, snippet, commitSHA)
	if err != nil {
		storeError(w, err)
		return
	}
	reviewID := c.ReviewID
	c = annotatedComment(repo, headRef, c)
	s.notify(reviewID)
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
	if err := validBody(req.Body); err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	if req.Author == "" {
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
	if err := validBody(req.Body); err != nil {
		httpError(w, http.StatusBadRequest, err)
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
