package store

import (
	"database/sql"
	"fmt"
)

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_path  TEXT NOT NULL,
  base_ref   TEXT NOT NULL,
  head_ref   TEXT NOT NULL,
  head_sha   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft',
  summary    TEXT NOT NULL DEFAULT '',
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
  indexed    INTEGER NOT NULL DEFAULT 0,
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
  review_id    INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  file_path    TEXT NOT NULL,
  reviewed_at  TEXT NOT NULL,
  content_hash TEXT NOT NULL DEFAULT '',
  worktree     INTEGER NOT NULL DEFAULT 0,
  indexed      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (review_id, file_path)
);
`)
	if err != nil {
		return err
	}
	// Columns added after the initial schema; a new one needs a row here and an entry in the CREATE TABLE above.
	added := []struct{ table, column, ddl string }{
		{"reviews", "summary", "summary TEXT NOT NULL DEFAULT ''"},
		{"comments", "resolved", "resolved INTEGER NOT NULL DEFAULT 0"},
		{"comments", "author", "author TEXT NOT NULL DEFAULT 'reviewer'"},
		{"comments", "worktree", "worktree INTEGER NOT NULL DEFAULT 0"},
		{"comments", "commit_sha", "commit_sha TEXT NOT NULL DEFAULT ''"},
		{"comments", "indexed", "indexed INTEGER NOT NULL DEFAULT 0"},
		{"reviewed_files", "content_hash", "content_hash TEXT NOT NULL DEFAULT ''"},
		{"reviewed_files", "worktree", "worktree INTEGER NOT NULL DEFAULT 0"},
		{"reviewed_files", "indexed", "indexed INTEGER NOT NULL DEFAULT 0"},
		{"replies", "author", "author TEXT NOT NULL DEFAULT 'reviewer'"},
	}
	for _, c := range added {
		if err := s.ensureColumn(c.table, c.column, c.ddl); err != nil {
			return fmt.Errorf("add %s.%s: %w", c.table, c.column, err)
		}
	}
	return nil
}

// SQLite lacks ADD COLUMN IF NOT EXISTS; table/column/ddl are code constants, not user input.
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
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_, err = s.db.Exec("ALTER TABLE " + table + " ADD COLUMN " + ddl)
	return err
}
