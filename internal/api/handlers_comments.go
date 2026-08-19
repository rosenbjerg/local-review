// Comment and reply endpoints. A comment is a thread root carrying the anchor
// (path, line range, side, and the commit it was resolved against); a reply is
// body-only and hangs off one.
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
	// The side the range is anchored to. Omitted is the head side, which is what
	// an API agent commenting on committed code wants — see the agent prompts.
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
	// The same path rule every read endpoint enforces. Without it the store accepted
	// paths no file can have — "" and "../../etc/passwd" — which the export then
	// rendered as an empty or nonsense "## " file heading.
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
	if repo != nil {
		cs := []store.Comment{*c}
		// One comment, so a warm-up would cost more than it saves.
		annotateComments(repo, headRef, cs, newContentCache(repo, headRef))
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
	// The range may have moved, so re-capture the snippet and re-resolve the anchor
	// commit against the new range on the comment's own side — else the stored
	// snippet/commit_sha still describe the old lines and staleness misfires. Read
	// the existing comment for its side (worktree/index/head) and path.
	existing, err := s.Store.GetComment(id)
	if err != nil {
		storeError(w, err)
		return
	}
	snippet := ""
	commitSHA := existing.CommitSHA
	if req.StartLine > 0 {
		if repoPath, headRef, err := s.Store.ReviewRepoHead(existing.ReviewID); err == nil {
			repo := git.New(repoPath)
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
	if err := validBody(req.Body); err != nil {
		httpError(w, http.StatusBadRequest, err)
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
