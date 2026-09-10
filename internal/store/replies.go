package store

import (
	"database/sql"
	"time"
)

type Reply struct {
	ID        int64     `json:"id"`
	CommentID int64     `json:"commentId"`
	Body      string    `json:"body"`
	Author    string    `json:"author"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// The SELECT order here and the Scan order in scanReply must move together.
const replyCols = `id, comment_id, body, created_at, updated_at, author`

func scanReply(sc rowScanner) (Reply, error) {
	var rep Reply
	var created, updated string
	if err := sc.Scan(&rep.ID, &rep.CommentID, &rep.Body, &created, &updated, &rep.Author); err != nil {
		return Reply{}, err
	}
	rep.CreatedAt, _ = time.Parse(timeFmt, created)
	rep.UpdatedAt, _ = time.Parse(timeFmt, updated)
	return rep, nil
}

func scanReplies(rows *sql.Rows) ([]Reply, error) {
	defer rows.Close()
	out := []Reply{}
	for rows.Next() {
		rep, err := scanReply(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rep)
	}
	return out, rows.Err()
}

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

func (s *Store) getReplies(commentID int64) ([]Reply, error) {
	rows, err := s.db.Query(
		`SELECT `+replyCols+` FROM replies WHERE comment_id=? ORDER BY created_at, id`, commentID)
	if err != nil {
		return nil, err
	}
	return scanReplies(rows)
}

func (s *Store) getReply(id int64) (*Reply, error) {
	rep, err := scanReply(s.db.QueryRow(`SELECT `+replyCols+` FROM replies WHERE id=?`, id))
	if err != nil {
		return nil, err
	}
	return &rep, nil
}

func (s *Store) AddReply(commentID int64, body, author string) (*Reply, int64, error) {
	var reviewID int64
	if err := s.db.QueryRow(`SELECT review_id FROM comments WHERE id=?`, commentID).Scan(&reviewID); err != nil {
		return nil, 0, err
	}
	now := nowStr()
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

func (s *Store) UpdateReply(id int64, body string) (*Reply, int64, error) {
	now := nowStr()
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
