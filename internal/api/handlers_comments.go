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

func (s *Server) handleAddComment(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	req, err := decodeBody[addCommentReq](w, r)
	if err != nil {
		return err
	}
	if err := validStartLine(req.StartLine); err != nil {
		return err
	}
	// The store accepts any string, so the read endpoints' path rule has to apply here too.
	if err := validPath(req.FilePath); err != nil {
		return err
	}
	if err := validBody(req.Body); err != nil {
		return err
	}
	side, err := sideOf(req.Side)
	if err != nil {
		return err
	}
	if req.EndLine < req.StartLine {
		req.EndLine = req.StartLine
	}
	if req.Type == "" {
		req.Type = store.CommentSuggestion
	}
	if err := validCommentType(req.Type); err != nil {
		return err
	}
	if req.Author == "" {
		// An omitted author is the coding agent; the browser sends "reviewer".
		req.Author = "agent"
	}
	repoPath, headRef, err := s.Store.ReviewRepoHead(id)
	if err != nil {
		return storeErr(err)
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
		return err
	}
	c = annotatedComment(repo, headRef, c)
	s.notify(id)
	return writeJSON(w, c)
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

func (s *Server) handleListComments(w http.ResponseWriter, r *http.Request) error {
	review, err := s.loadAnnotatedReview(r)
	if err != nil {
		return err
	}
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
	return writeJSON(w, map[string]any{"comments": comments})
}

// Pointers, so an omitted field keeps its stored value: a body edit that also had to
// restate the range would re-capture the snippet and erase a moved comment's staleness.
// Sending a range is what asks for a re-anchor.
type updateCommentReq struct {
	Body      *string            `json:"body"`
	Type      *store.CommentType `json:"type"`
	StartLine *int               `json:"startLine"`
	EndLine   *int               `json:"endLine"`
}

func (s *Server) handleUpdateComment(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	req, err := decodeBody[updateCommentReq](w, r)
	if err != nil {
		return err
	}
	existing, err := s.Store.GetComment(id)
	if err != nil {
		return storeErr(err)
	}
	body := existing.Body
	if req.Body != nil {
		if err := validBody(*req.Body); err != nil {
			return err
		}
		body = *req.Body
	}
	commentType := existing.Type
	if req.Type != nil {
		if err := validCommentType(*req.Type); err != nil {
			return err
		}
		commentType = *req.Type
	}
	startLine, endLine := existing.StartLine, existing.EndLine
	reanchor := req.StartLine != nil || req.EndLine != nil
	if req.StartLine != nil {
		startLine = *req.StartLine
	}
	if req.EndLine != nil {
		endLine = *req.EndLine
	}
	if err := validStartLine(startLine); err != nil {
		return err
	}
	if endLine < startLine {
		endLine = startLine
	}
	var repo *git.Repo
	var headRef string
	if repoPath, hr, err := s.Store.ReviewRepoHead(existing.ReviewID); err == nil {
		repo, headRef = git.New(repoPath), hr
	}
	snippet := existing.Snippet
	commitSHA := existing.CommitSHA
	if reanchor {
		snippet = ""
		if startLine > 0 && repo != nil {
			snippet = captureSnippet(repo, headRef, existing.FilePath, startLine, endLine, existing.Side)
			if sha, err := repo.ResolveSHA(headRef); err == nil {
				commitSHA = sha
			}
		}
	}
	c, err := s.Store.UpdateComment(id, body, commentType, startLine, endLine, snippet, commitSHA)
	if err != nil {
		return storeErr(err)
	}
	reviewID := c.ReviewID
	c = annotatedComment(repo, headRef, c)
	s.notify(reviewID)
	return writeJSON(w, c)
}

func (s *Server) handleDeleteComment(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	reviewID, err := s.Store.DeleteComment(id)
	if err != nil {
		return storeErr(err)
	}
	s.notify(reviewID)
	return noContent(w)
}

type setResolvedReq struct {
	Resolved bool `json:"resolved"`
}

func (s *Server) handleSetResolved(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	req, err := decodeBody[setResolvedReq](w, r)
	if err != nil {
		return err
	}
	reviewID, err := s.Store.SetCommentResolved(id, req.Resolved)
	if err != nil {
		return storeErr(err)
	}
	s.notify(reviewID)
	return noContent(w)
}

// --- replies ---

type replyReq struct {
	Body   string `json:"body"`
	Author string `json:"author"`
}

func (s *Server) handleAddReply(w http.ResponseWriter, r *http.Request) error {
	commentID, err := pathID(r)
	if err != nil {
		return err
	}
	req, err := decodeBody[replyReq](w, r)
	if err != nil {
		return err
	}
	if err := validBody(req.Body); err != nil {
		return err
	}
	if req.Author == "" {
		req.Author = "agent"
	}
	rep, reviewID, err := s.Store.AddReply(commentID, req.Body, req.Author)
	if err != nil {
		return storeErr(err)
	}
	s.notify(reviewID)
	return writeJSON(w, rep)
}

func (s *Server) handleUpdateReply(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	req, err := decodeBody[replyReq](w, r)
	if err != nil {
		return err
	}
	if err := validBody(req.Body); err != nil {
		return err
	}
	rep, reviewID, err := s.Store.UpdateReply(id, req.Body)
	if err != nil {
		return storeErr(err)
	}
	s.notify(reviewID)
	return writeJSON(w, rep)
}

func (s *Server) handleDeleteReply(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	reviewID, err := s.Store.DeleteReply(id)
	if err != nil {
		return storeErr(err)
	}
	s.notify(reviewID)
	return noContent(w)
}
