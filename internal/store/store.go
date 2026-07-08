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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_review ON comments(review_id);
CREATE TABLE IF NOT EXISTS reviewed_files (
  review_id   INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  file_path   TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  PRIMARY KEY (review_id, file_path)
);
`)
	return err
}

const timeFmt = time.RFC3339

// CreateOrGetReview returns the existing review for (repo, base, head) or creates
// one. A review is matched regardless of status so that exporting (which marks it
// 'exported') does not orphan an in-progress review — re-opening the same branch
// resumes it with its comments intact. HeadSHA is refreshed on fetch.
func (s *Store) CreateOrGetReview(repoPath, base, head, sha string) (*Review, error) {
	row := s.db.QueryRow(
		`SELECT id FROM reviews WHERE repo_path=? AND base_ref=? AND head_ref=? ORDER BY id DESC LIMIT 1`,
		repoPath, base, head)
	var id int64
	err := row.Scan(&id)
	now := time.Now().UTC().Format(timeFmt)
	switch err {
	case nil:
		if _, err := s.db.Exec(`UPDATE reviews SET head_sha=?, updated_at=? WHERE id=?`, sha, now, id); err != nil {
			return nil, err
		}
	case sql.ErrNoRows:
		res, err := s.db.Exec(
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
	r.Comments = comments
	reviewed, err := s.listReviewedFiles(id)
	if err != nil {
		return nil, err
	}
	r.ReviewedFiles = reviewed
	return &r, nil
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

func (s *Store) SetStatus(id int64, status string) error {
	_, err := s.db.Exec(`UPDATE reviews SET status=?, updated_at=? WHERE id=?`,
		status, time.Now().UTC().Format(timeFmt), id)
	return err
}

func (s *Store) listComments(reviewID int64) ([]Comment, error) {
	rows, err := s.db.Query(
		`SELECT id, review_id, file_path, start_line, end_line, snippet, type, body, created_at, updated_at
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
			&c.Snippet, &c.Type, &c.Body, &created, &updated); err != nil {
			return nil, err
		}
		c.CreatedAt, _ = time.Parse(timeFmt, created)
		c.UpdatedAt, _ = time.Parse(timeFmt, updated)
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) AddComment(c Comment) (*Comment, error) {
	now := time.Now().UTC().Format(timeFmt)
	res, err := s.db.Exec(
		`INSERT INTO comments (review_id, file_path, start_line, end_line, snippet, type, body, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?)`,
		c.ReviewID, c.FilePath, c.StartLine, c.EndLine, c.Snippet, c.Type, c.Body, now, now)
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

func (s *Store) DeleteComment(id int64) error {
	_, err := s.db.Exec(`DELETE FROM comments WHERE id=?`, id)
	return err
}

func (s *Store) getComment(id int64) (*Comment, error) {
	var c Comment
	var created, updated string
	err := s.db.QueryRow(
		`SELECT id, review_id, file_path, start_line, end_line, snippet, type, body, created_at, updated_at
		 FROM comments WHERE id=?`, id).
		Scan(&c.ID, &c.ReviewID, &c.FilePath, &c.StartLine, &c.EndLine, &c.Snippet, &c.Type, &c.Body, &created, &updated)
	if err != nil {
		return nil, err
	}
	c.CreatedAt, _ = time.Parse(timeFmt, created)
	c.UpdatedAt, _ = time.Parse(timeFmt, updated)
	return &c, nil
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
