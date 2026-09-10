package store

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

type ReviewedFile struct {
	Path        string
	ContentHash string
	// The side the fingerprint was captured from, so the re-hash reads the same content.
	Side Side
}

func (s *Store) ListReviewedFilesFull(reviewID int64) ([]ReviewedFile, error) {
	rows, err := s.db.Query(
		`SELECT file_path, content_hash, worktree, indexed FROM reviewed_files WHERE review_id=? ORDER BY file_path`, reviewID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ReviewedFile{}
	for rows.Next() {
		var f ReviewedFile
		var worktree, indexed bool
		if err := rows.Scan(&f.Path, &f.ContentHash, &worktree, &indexed); err != nil {
			return nil, err
		}
		f.Side = sideFromFlags(worktree, indexed)
		out = append(out, f)
	}
	return out, rows.Err()
}

// FileReviewMark pairs a path with its content fingerprint (empty when unmarking).
type FileReviewMark struct {
	Path        string
	ContentHash string
}

// SetFilesReviewed marks or unmarks a batch in one transaction; the upsert refreshes the fingerprint.
func (s *Store) SetFilesReviewed(reviewID int64, marks []FileReviewMark, reviewed bool, side Side) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := nowStr()
	worktree, indexed := side.flags()
	for _, m := range marks {
		if reviewed {
			_, err = tx.Exec(
				`INSERT INTO reviewed_files (review_id, file_path, reviewed_at, content_hash, worktree, indexed) VALUES (?,?,?,?,?,?)
				 ON CONFLICT(review_id, file_path) DO UPDATE SET
				   reviewed_at=excluded.reviewed_at, content_hash=excluded.content_hash, worktree=excluded.worktree, indexed=excluded.indexed`,
				reviewID, m.Path, now, m.ContentHash, worktree, indexed)
		} else {
			_, err = tx.Exec(`DELETE FROM reviewed_files WHERE review_id=? AND file_path=?`, reviewID, m.Path)
		}
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}
