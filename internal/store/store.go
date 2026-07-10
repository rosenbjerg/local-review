// Package store persists reviews and comments in SQLite.
package store

import (
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

// Anchor statuses for Comment.AnchorStatus, derived by the API layer from the
// current head (see internal/api/annotate.go). Shared here because the field
// lives on Comment and both the API and export packages compare against them.
const (
	AnchorCurrent  = "current"  // snippet still sits at the stored line range
	AnchorMoved    = "moved"    // snippet relocated to a unique new range (Current* lines)
	AnchorOutdated = "outdated" // snippet gone, ambiguous, or file unreadable
)

type Review struct {
	ID        int64     `json:"id"`
	RepoPath  string    `json:"repoPath"`
	BaseRef   string    `json:"baseRef"`
	HeadRef   string    `json:"headRef"`
	HeadSHA   string    `json:"headSha"`
	Status        string    `json:"status"` // draft | exported
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
	Comments      []Comment `json:"comments"`
	ReviewedFiles []string  `json:"reviewedFiles"`
}

type Comment struct {
	ID        int64     `json:"id"`
	ReviewID  int64     `json:"reviewId"`
	FilePath  string    `json:"filePath"`
	StartLine int       `json:"startLine"`
	EndLine   int       `json:"endLine"`
	Snippet   string    `json:"snippet"`
	Type      string    `json:"type"` // bug | suggestion | question | nit
	Body      string    `json:"body"`
	Author    string    `json:"author"` // "reviewer" for browser-created; API clients may set their own
	Resolved  bool      `json:"resolved"`
	CommitSHA string    `json:"commitSha"` // head SHA the comment was anchored against (best-effort)
	Worktree  bool      `json:"worktree"`  // anchored against the working tree (uncommitted diff), not head
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	Replies   []Reply   `json:"replies"`

	// Derived by the API layer (internal/api.annotate), never persisted: the
	// live location of the comment relative to the current head. AnchorStatus is
	// "current" | "moved" | "outdated"; the Current* lines carry the relocated
	// range when moved. Zero-valued on rows loaded straight from the store.
	AnchorStatus     string `json:"anchorStatus,omitempty"`
	CurrentStartLine int    `json:"currentStartLine,omitempty"`
	CurrentEndLine   int    `json:"currentEndLine,omitempty"`
}

// Reply is a follow-up on a Comment. It carries no anchor or type of its own —
// those belong to the parent comment (the thread root). Threads are exactly two
// levels deep: replies reference a comment and nothing references a reply.
type Reply struct {
	ID        int64     `json:"id"`
	CommentID int64     `json:"commentId"`
	Body      string    `json:"body"`
	Author    string    `json:"author"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	// SQLite's foreign_keys pragma is per-connection, so with a pooled DB some
	// connections could miss it and skip ON DELETE CASCADE. A single connection
	// makes the one-time pragma below authoritative; DB access is low-frequency
	// (git diffs/file reads don't hit SQLite), so serializing it is free, and it
	// also gives CreateOrGetReview's transaction full check-then-insert atomicity.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`); err != nil {
		return nil, err
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_path  TEXT NOT NULL,
  base_ref   TEXT NOT NULL,
  head_ref   TEXT NOT NULL,
  head_sha   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id  INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  file_path  TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line   INTEGER NOT NULL,
  snippet    TEXT NOT NULL DEFAULT '',
  type       TEXT NOT NULL DEFAULT 'suggestion',
  body       TEXT NOT NULL DEFAULT '',
  author     TEXT NOT NULL DEFAULT 'reviewer',
  resolved   INTEGER NOT NULL DEFAULT 0,
  commit_sha TEXT NOT NULL DEFAULT '',
  worktree   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_review ON comments(review_id);
CREATE TABLE IF NOT EXISTS replies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  body       TEXT NOT NULL DEFAULT '',
  author     TEXT NOT NULL DEFAULT 'reviewer',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_replies_comment ON replies(comment_id);
CREATE TABLE IF NOT EXISTS reviewed_files (
  review_id   INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  file_path   TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  PRIMARY KEY (review_id, file_path)
);
`)
	if err != nil {
		return err
	}
	// Columns added after the initial schema. CREATE TABLE IF NOT EXISTS won't
	// backfill them onto tables created before they existed, so add them
	// explicitly for older databases (each is a no-op once present).
	if err := s.ensureColumn("comments", "resolved", "resolved INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := s.ensureColumn("comments", "author", "author TEXT NOT NULL DEFAULT 'reviewer'"); err != nil {
		return err
	}
	if err := s.ensureColumn("comments", "worktree", "worktree INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := s.ensureColumn("comments", "commit_sha", "commit_sha TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	return s.ensureColumn("replies", "author", "author TEXT NOT NULL DEFAULT 'reviewer'")
}

// ensureColumn adds a column to a table if it is not already present, making a
// new column idempotent across upgrades (SQLite has no ADD COLUMN IF NOT EXISTS).
// table/column/ddl are trusted code constants, not user input.
func (s *Store) ensureColumn(table, column, ddl string) error {
	rows, err := s.db.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var (
			cid, notnull, pk int
			name, ctype      string
			dflt             sql.NullString
		)
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return err
		}
		if name == column {
			return nil // already present
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_, err = s.db.Exec("ALTER TABLE " + table + " ADD COLUMN " + ddl)
	return err
}

const timeFmt = time.RFC3339

// CreateOrGetReview returns the existing review for (repo, base, head) or creates
// one. A review is matched regardless of status so that exporting (which marks it
// 'exported') does not orphan an in-progress review — re-opening the same branch
// resumes it with its comments intact. HeadSHA is refreshed on fetch.
func (s *Store) CreateOrGetReview(repoPath, base, head, sha string) (*Review, error) {
	// Run the check-then-insert in a transaction so two concurrent callers for
	// the same (repo, base, head) can't both insert and split comments across
	// duplicate rows. With the single connection (see Open), the transaction
	// holds it end-to-end, so a concurrent creator blocks until commit and then
	// its SELECT sees the inserted row.
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var id int64
	err = tx.QueryRow(
		`SELECT id FROM reviews WHERE repo_path=? AND base_ref=? AND head_ref=? ORDER BY id DESC LIMIT 1`,
		repoPath, base, head).Scan(&id)
	now := time.Now().UTC().Format(timeFmt)
	switch err {
	case nil:
		if _, err := tx.Exec(`UPDATE reviews SET head_sha=?, updated_at=? WHERE id=?`, sha, now, id); err != nil {
			return nil, err
		}
	case sql.ErrNoRows:
		res, err := tx.Exec(
			`INSERT INTO reviews (repo_path, base_ref, head_ref, head_sha, status, created_at, updated_at)
			 VALUES (?,?,?,?, 'draft', ?, ?)`,
			repoPath, base, head, sha, now, now)
		if err != nil {
			return nil, err
		}
		id, _ = res.LastInsertId()
	default:
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetReview(id)
}

func (s *Store) GetReview(id int64) (*Review, error) {
	var r Review
	var created, updated string
	err := s.db.QueryRow(
		`SELECT id, repo_path, base_ref, head_ref, head_sha, status, created_at, updated_at FROM reviews WHERE id=?`, id).
		Scan(&r.ID, &r.RepoPath, &r.BaseRef, &r.HeadRef, &r.HeadSHA, &r.Status, &created, &updated)
	if err != nil {
		return nil, err
	}
	r.CreatedAt, _ = time.Parse(timeFmt, created)
	r.UpdatedAt, _ = time.Parse(timeFmt, updated)
	comments, err := s.listComments(id)
	if err != nil {
		return nil, err
	}
	replies, err := s.listReplies(id)
	if err != nil {
		return nil, err
	}
	byComment := make(map[int64][]Reply, len(replies))
	for _, rep := range replies {
		byComment[rep.CommentID] = append(byComment[rep.CommentID], rep)
	}
	for i := range comments {
		if rs := byComment[comments[i].ID]; rs != nil {
			comments[i].Replies = rs
		}
	}
	r.Comments = comments
	reviewed, err := s.listReviewedFiles(id)
	if err != nil {
		return nil, err
	}
	r.ReviewedFiles = reviewed
	return &r, nil
}

// ReviewRepoHead returns a review's repo path and head ref without loading its
// comments — enough for the API to resolve the current head SHA when anchoring a
// new comment.
func (s *Store) ReviewRepoHead(id int64) (repoPath, headRef string, err error) {
	err = s.db.QueryRow(`SELECT repo_path, head_ref FROM reviews WHERE id=?`, id).Scan(&repoPath, &headRef)
	return
}

func (s *Store) listReviewedFiles(reviewID int64) ([]string, error) {
	rows, err := s.db.Query(
		`SELECT file_path FROM reviewed_files WHERE review_id=? ORDER BY file_path`, reviewID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// SetFileReviewed marks (or unmarks) a file as reviewed within a review.
func (s *Store) SetFileReviewed(reviewID int64, path string, reviewed bool) error {
	if reviewed {
		_, err := s.db.Exec(
			`INSERT INTO reviewed_files (review_id, file_path, reviewed_at) VALUES (?,?,?)
			 ON CONFLICT(review_id, file_path) DO NOTHING`,
			reviewID, path, time.Now().UTC().Format(timeFmt))
		return err
	}
	_, err := s.db.Exec(`DELETE FROM reviewed_files WHERE review_id=? AND file_path=?`, reviewID, path)
	return err
}

func (s *Store) ListReviews() ([]Review, error) {
	rows, err := s.db.Query(
		`SELECT id, repo_path, base_ref, head_ref, head_sha, status, created_at, updated_at FROM reviews ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Review
	for rows.Next() {
		var r Review
		var created, updated string
		if err := rows.Scan(&r.ID, &r.RepoPath, &r.BaseRef, &r.HeadRef, &r.HeadSHA, &r.Status, &created, &updated); err != nil {
			return nil, err
		}
		r.CreatedAt, _ = time.Parse(timeFmt, created)
		r.UpdatedAt, _ = time.Parse(timeFmt, updated)
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) DeleteReview(id int64) error {
	_, err := s.db.Exec(`DELETE FROM reviews WHERE id=?`, id)
	return err
}

// ResetReview clears a review's feedback in one transaction: every comment (its
// replies cascade via the FK) and every reviewed-file mark. The review row
// itself stays, so re-opening the same branch resumes it empty rather than
// creating a fresh review.
func (s *Store) ResetReview(id int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM comments WHERE review_id=?`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM reviewed_files WHERE review_id=?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) SetStatus(id int64, status string) error {
	_, err := s.db.Exec(`UPDATE reviews SET status=?, updated_at=? WHERE id=?`,
		status, time.Now().UTC().Format(timeFmt), id)
	return err
}

func (s *Store) listComments(reviewID int64) ([]Comment, error) {
	rows, err := s.db.Query(
		`SELECT id, review_id, file_path, start_line, end_line, snippet, type, body, created_at, updated_at, resolved, author, commit_sha, worktree
		 FROM comments WHERE review_id=? ORDER BY file_path, start_line`, reviewID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Comment
	for rows.Next() {
		var c Comment
		var created, updated string
		if err := rows.Scan(&c.ID, &c.ReviewID, &c.FilePath, &c.StartLine, &c.EndLine,
			&c.Snippet, &c.Type, &c.Body, &created, &updated, &c.Resolved, &c.Author, &c.CommitSHA, &c.Worktree); err != nil {
			return nil, err
		}
		c.CreatedAt, _ = time.Parse(timeFmt, created)
		c.UpdatedAt, _ = time.Parse(timeFmt, updated)
		c.Replies = []Reply{} // never null in JSON; GetReview fills in any replies
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) AddComment(c Comment) (*Comment, error) {
	now := time.Now().UTC().Format(timeFmt)
	res, err := s.db.Exec(
		`INSERT INTO comments (review_id, file_path, start_line, end_line, snippet, type, body, author, commit_sha, worktree, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
		c.ReviewID, c.FilePath, c.StartLine, c.EndLine, c.Snippet, c.Type, c.Body, c.Author, c.CommitSHA, c.Worktree, now, now)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return s.getComment(id)
}

func (s *Store) UpdateComment(id int64, body, ctype string, start, end int) (*Comment, error) {
	now := time.Now().UTC().Format(timeFmt)
	_, err := s.db.Exec(
		`UPDATE comments SET body=?, type=?, start_line=?, end_line=?, updated_at=? WHERE id=?`,
		body, ctype, start, end, now, id)
	if err != nil {
		return nil, err
	}
	return s.getComment(id)
}

// SetCommentResolved marks a comment (thread root) resolved or reopened and
// returns the id of its review so the caller can publish an SSE ping.
func (s *Store) SetCommentResolved(id int64, resolved bool) (int64, error) {
	now := time.Now().UTC().Format(timeFmt)
	if _, err := s.db.Exec(
		`UPDATE comments SET resolved=?, updated_at=? WHERE id=?`, resolved, now, id); err != nil {
		return 0, err
	}
	return s.reviewIDForComment(id)
}

// DeleteComment removes a comment and returns the id of the review it belonged
// to, so the caller can notify subscribers of that review after the row is gone.
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

func (s *Store) getComment(id int64) (*Comment, error) {
	var c Comment
	var created, updated string
	err := s.db.QueryRow(
		`SELECT id, review_id, file_path, start_line, end_line, snippet, type, body, created_at, updated_at, resolved, author, commit_sha, worktree
		 FROM comments WHERE id=?`, id).
		Scan(&c.ID, &c.ReviewID, &c.FilePath, &c.StartLine, &c.EndLine, &c.Snippet, &c.Type, &c.Body, &created, &updated, &c.Resolved, &c.Author, &c.CommitSHA, &c.Worktree)
	if err != nil {
		return nil, err
	}
	c.CreatedAt, _ = time.Parse(timeFmt, created)
	c.UpdatedAt, _ = time.Parse(timeFmt, updated)
	replies, err := s.getReplies(id)
	if err != nil {
		return nil, err
	}
	c.Replies = replies
	return &c, nil
}

// scanReplies collects reply rows from an already-executed query.
func scanReplies(rows *sql.Rows) ([]Reply, error) {
	defer rows.Close()
	out := []Reply{}
	for rows.Next() {
		var rep Reply
		var created, updated string
		if err := rows.Scan(&rep.ID, &rep.CommentID, &rep.Body, &created, &updated, &rep.Author); err != nil {
			return nil, err
		}
		rep.CreatedAt, _ = time.Parse(timeFmt, created)
		rep.UpdatedAt, _ = time.Parse(timeFmt, updated)
		out = append(out, rep)
	}
	return out, rows.Err()
}

// listReplies returns every reply belonging to a review (joined via its
// comments), ordered so GetReview can bucket them under each comment.
func (s *Store) listReplies(reviewID int64) ([]Reply, error) {
	rows, err := s.db.Query(
		`SELECT r.id, r.comment_id, r.body, r.created_at, r.updated_at, r.author
		 FROM replies r JOIN comments c ON c.id = r.comment_id
		 WHERE c.review_id=? ORDER BY r.comment_id, r.created_at, r.id`, reviewID)
	if err != nil {
		return nil, err
	}
	return scanReplies(rows)
}

// getReplies returns the replies on a single comment, oldest first.
func (s *Store) getReplies(commentID int64) ([]Reply, error) {
	rows, err := s.db.Query(
		`SELECT id, comment_id, body, created_at, updated_at, author
		 FROM replies WHERE comment_id=? ORDER BY created_at, id`, commentID)
	if err != nil {
		return nil, err
	}
	return scanReplies(rows)
}

func (s *Store) getReply(id int64) (*Reply, error) {
	var rep Reply
	var created, updated string
	err := s.db.QueryRow(
		`SELECT id, comment_id, body, created_at, updated_at, author FROM replies WHERE id=?`, id).
		Scan(&rep.ID, &rep.CommentID, &rep.Body, &created, &updated, &rep.Author)
	if err != nil {
		return nil, err
	}
	rep.CreatedAt, _ = time.Parse(timeFmt, created)
	rep.UpdatedAt, _ = time.Parse(timeFmt, updated)
	return &rep, nil
}

// AddReply appends a reply to a comment and returns it along with the id of the
// review it belongs to, so the caller can publish an SSE ping for that review.
func (s *Store) AddReply(commentID int64, body, author string) (*Reply, int64, error) {
	var reviewID int64
	if err := s.db.QueryRow(`SELECT review_id FROM comments WHERE id=?`, commentID).Scan(&reviewID); err != nil {
		return nil, 0, err
	}
	now := time.Now().UTC().Format(timeFmt)
	res, err := s.db.Exec(
		`INSERT INTO replies (comment_id, body, author, created_at, updated_at) VALUES (?,?,?,?,?)`,
		commentID, body, author, now, now)
	if err != nil {
		return nil, 0, err
	}
	id, _ := res.LastInsertId()
	rep, err := s.getReply(id)
	return rep, reviewID, err
}

// UpdateReply edits a reply's body and returns it with its review id.
func (s *Store) UpdateReply(id int64, body string) (*Reply, int64, error) {
	now := time.Now().UTC().Format(timeFmt)
	if _, err := s.db.Exec(`UPDATE replies SET body=?, updated_at=? WHERE id=?`, body, now, id); err != nil {
		return nil, 0, err
	}
	rep, err := s.getReply(id)
	if err != nil {
		return nil, 0, err
	}
	reviewID, err := s.reviewIDForComment(rep.CommentID)
	return rep, reviewID, err
}

// DeleteReply removes a reply and returns the id of the review it belonged to,
// so the caller can notify that review's subscribers after the row is gone.
func (s *Store) DeleteReply(id int64) (int64, error) {
	var commentID int64
	if err := s.db.QueryRow(`SELECT comment_id FROM replies WHERE id=?`, id).Scan(&commentID); err != nil {
		return 0, err
	}
	if _, err := s.db.Exec(`DELETE FROM replies WHERE id=?`, id); err != nil {
		return 0, err
	}
	return s.reviewIDForComment(commentID)
}

func (s *Store) reviewIDForComment(commentID int64) (int64, error) {
	var reviewID int64
	err := s.db.QueryRow(`SELECT review_id FROM comments WHERE id=?`, commentID).Scan(&reviewID)
	return reviewID, err
}

// PruneDrafts deletes draft reviews not updated within the retention window.
func (s *Store) PruneDrafts(olderThan time.Duration) (int64, error) {
	cutoff := time.Now().UTC().Add(-olderThan).Format(timeFmt)
	res, err := s.db.Exec(`DELETE FROM reviews WHERE status='draft' AND updated_at < ?`, cutoff)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func (s *Store) Touch(reviewID int64) error {
	_, err := s.db.Exec(`UPDATE reviews SET updated_at=? WHERE id=?`,
		time.Now().UTC().Format(timeFmt), reviewID)
	if err != nil {
		return fmt.Errorf("touch review: %w", err)
	}
	return nil
}
