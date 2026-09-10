// Package store persists reviews and comments in SQLite.
package store

import (
	"database/sql"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	// foreign_keys is per-connection, so it goes in the DSN; WAL persists in the file, so one PRAGMA suffices.
	db, err := sql.Open("sqlite", path+"?_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}
	// One connection serializes access, which gives CreateOrGetReview's check-then-insert full atomicity.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`PRAGMA journal_mode=WAL;`); err != nil {
		return nil, err
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

const timeFmt = time.RFC3339

func nowStr() string { return time.Now().UTC().Format(timeFmt) }

type rowScanner interface {
	Scan(dest ...any) error
}
