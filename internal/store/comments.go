package store

import (
	"time"
)

type AnchorStatus string

const (
	AnchorCurrent  AnchorStatus = "current"
	AnchorMoved    AnchorStatus = "moved"
	AnchorOutdated AnchorStatus = "outdated"
)

type CommentType string

const (
	CommentBug        CommentType = "bug"
	CommentSuggestion CommentType = "suggestion"
	CommentQuestion   CommentType = "question"
	CommentNit        CommentType = "nit"
)

type Comment struct {
	ID        int64       `json:"id"`
	ReviewID  int64       `json:"reviewId"`
	FilePath  string      `json:"filePath"`
	StartLine int         `json:"startLine"`
	EndLine   int         `json:"endLine"`
	Snippet   string      `json:"snippet"`
	Type      CommentType `json:"type"`
	Body      string      `json:"body"`
	Author    string      `json:"author"`
	Resolved  bool        `json:"resolved"`
	CommitSHA string      `json:"commitSha"`
	// Stored as two flags (see side.go); one value everywhere else.
	Side      Side      `json:"side"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	Replies   []Reply   `json:"replies"`

	// Computed by the API layer, never persisted; Current* carry the relocated range and path when moved.
	AnchorStatus     AnchorStatus `json:"anchorStatus,omitempty"`
	CurrentStartLine int          `json:"currentStartLine,omitempty"`
	CurrentEndLine   int          `json:"currentEndLine,omitempty"`
	CurrentFilePath  string       `json:"currentFilePath,omitempty"`
}

// The SELECT order here and the Scan order in scanComment must move together.
const commentCols = `id, review_id, file_path, start_line, end_line, snippet, type, body, created_at, updated_at, resolved, author, commit_sha, worktree, indexed`

func scanComment(sc rowScanner) (Comment, error) {
	var c Comment
	var created, updated string
	var worktree, indexed bool
	if err := sc.Scan(&c.ID, &c.ReviewID, &c.FilePath, &c.StartLine, &c.EndLine,
		&c.Snippet, &c.Type, &c.Body, &created, &updated, &c.Resolved, &c.Author, &c.CommitSHA, &worktree, &indexed); err != nil {
		return Comment{}, err
	}
	c.Side = sideFromFlags(worktree, indexed)
	c.CreatedAt, _ = time.Parse(timeFmt, created)
	c.UpdatedAt, _ = time.Parse(timeFmt, updated)
	c.Replies = []Reply{} // never null in JSON
	return c, nil
}

func (s *Store) listComments(reviewID int64) ([]Comment, error) {
	rows, err := s.db.Query(
		`SELECT `+commentCols+` FROM comments WHERE review_id=? ORDER BY file_path, start_line`, reviewID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Comment{} // never null in JSON
	for rows.Next() {
		c, err := scanComment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) AddComment(c Comment) (*Comment, error) {
	now := nowStr()
	worktree, indexed := c.Side.flags()
	res, err := s.db.Exec(
		`INSERT INTO comments (review_id, file_path, start_line, end_line, snippet, type, body, author, commit_sha, worktree, indexed, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		c.ReviewID, c.FilePath, c.StartLine, c.EndLine, c.Snippet, c.Type, c.Body, c.Author, c.CommitSHA, worktree, indexed, now, now)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return s.GetComment(id)
}

// UpdateComment rewrites the editable fields plus the anchor basis (snippet and commit_sha) for the new range.
func (s *Store) UpdateComment(id int64, body string, ctype CommentType, start, end int, snippet, commitSHA string) (*Comment, error) {
	now := nowStr()
	_, err := s.db.Exec(
		`UPDATE comments SET body=?, type=?, start_line=?, end_line=?, snippet=?, commit_sha=?, updated_at=? WHERE id=?`,
		body, ctype, start, end, snippet, commitSHA, now, id)
	if err != nil {
		return nil, err
	}
	return s.GetComment(id)
}

// SetCommentResolved deliberately leaves updated_at alone, or the UI's "(edited)" marker would fire on resolve.
func (s *Store) SetCommentResolved(id int64, resolved bool) (int64, error) {
	if _, err := s.db.Exec(
		`UPDATE comments SET resolved=? WHERE id=?`, resolved, id); err != nil {
		return 0, err
	}
	return s.reviewIDForComment(id)
}

func (s *Store) DeleteComment(id int64) (int64, error) {
	var reviewID int64
	if err := s.db.QueryRow(`SELECT review_id FROM comments WHERE id=?`, id).Scan(&reviewID); err != nil {
		return 0, err
	}
	if _, err := s.db.Exec(`DELETE FROM comments WHERE id=?`, id); err != nil {
		return 0, err
	}
	return reviewID, nil
}

// GetComment reads one comment with its replies.
func (s *Store) GetComment(id int64) (*Comment, error) {
	c, err := scanComment(s.db.QueryRow(`SELECT `+commentCols+` FROM comments WHERE id=?`, id))
	if err != nil {
		return nil, err
	}
	replies, err := s.getReplies(id)
	if err != nil {
		return nil, err
	}
	c.Replies = replies
	return &c, nil
}

func (s *Store) reviewIDForComment(commentID int64) (int64, error) {
	var reviewID int64
	err := s.db.QueryRow(`SELECT review_id FROM comments WHERE id=?`, commentID).Scan(&reviewID)
	return reviewID, err
}
