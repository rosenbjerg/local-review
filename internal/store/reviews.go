package store

import (
	"database/sql"
	"fmt"
	"time"
)

type ReviewStatus string

const (
	StatusDraft    ReviewStatus = "draft"
	StatusExported ReviewStatus = "exported"
)

type Review struct {
	ID            int64        `json:"id"`
	RepoPath      string       `json:"repoPath"`
	BaseRef       string       `json:"baseRef"`
	HeadRef       string       `json:"headRef"`
	HeadSHA       string       `json:"headSha"`
	Status        ReviewStatus `json:"status"`
	Summary       string       `json:"summary"`
	CreatedAt     time.Time    `json:"createdAt"`
	UpdatedAt     time.Time    `json:"updatedAt"`
	Comments      []Comment    `json:"comments"`
	ReviewedFiles []string     `json:"reviewedFiles"`

	// Set by the API layer, never persisted, when the repo or head couldn't be read and nothing was annotated.
	AnnotationError string `json:"annotationError,omitempty"`
}

// The SELECT order here and the Scan order in scanReview must move together.
const reviewCols = `id, repo_path, base_ref, head_ref, head_sha, status, created_at, updated_at, summary`

func scanReview(sc rowScanner) (Review, error) {
	var r Review
	var created, updated string
	if err := sc.Scan(&r.ID, &r.RepoPath, &r.BaseRef, &r.HeadRef, &r.HeadSHA, &r.Status, &created, &updated, &r.Summary); err != nil {
		return Review{}, err
	}
	r.CreatedAt, _ = time.Parse(timeFmt, created)
	r.UpdatedAt, _ = time.Parse(timeFmt, updated)
	return r, nil
}

// CreateOrGetReview matches regardless of status, so exporting never orphans an in-progress review.
func (s *Store) CreateOrGetReview(repoPath, base, head, sha string) (*Review, error) {
	// Check-then-insert in one transaction, so concurrent callers can't create duplicate rows.
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var id int64
	err = tx.QueryRow(
		`SELECT id FROM reviews WHERE repo_path=? AND base_ref=? AND head_ref=? ORDER BY id DESC LIMIT 1`,
		repoPath, base, head).Scan(&id)
	now := nowStr()
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
	r, err := scanReview(s.db.QueryRow(`SELECT `+reviewCols+` FROM reviews WHERE id=?`, id))
	if err != nil {
		return nil, err
	}
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

func (s *Store) ReviewRepoHead(id int64) (repoPath, headRef string, err error) {
	err = s.db.QueryRow(`SELECT repo_path, head_ref FROM reviews WHERE id=?`, id).Scan(&repoPath, &headRef)
	return
}

func (s *Store) ListReviews() ([]Review, error) {
	rows, err := s.db.Query(`SELECT ` + reviewCols + ` FROM reviews ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Review
	for rows.Next() {
		r, err := scanReview(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) DeleteReview(id int64) error {
	_, err := s.db.Exec(`DELETE FROM reviews WHERE id=?`, id)
	return err
}

// ResetReview clears comments, marks and summary but keeps the row, so reopening the branch resumes it empty.
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
	if _, err := tx.Exec(`UPDATE reviews SET summary='', updated_at=? WHERE id=?`, nowStr(), id); err != nil {
		return err
	}
	return tx.Commit()
}

// SetReviewSummary reports a missing review via RowsAffected, since an empty summary is a legitimate value.
func (s *Store) SetReviewSummary(id int64, summary string) error {
	res, err := s.db.Exec(`UPDATE reviews SET summary=?, updated_at=? WHERE id=?`,
		summary, nowStr(), id)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) SetStatus(id int64, status ReviewStatus) error {
	_, err := s.db.Exec(`UPDATE reviews SET status=?, updated_at=? WHERE id=?`,
		status, nowStr(), id)
	return err
}

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
		nowStr(), reviewID)
	if err != nil {
		return fmt.Errorf("touch review: %w", err)
	}
	return nil
}
