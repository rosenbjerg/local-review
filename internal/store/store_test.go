package store

import (
	"path/filepath"
	"sync"
	"testing"
)

func openTemp(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

// Concurrent CreateOrGetReview for the same (repo, base, head) must converge on
// a single review row rather than inserting duplicates.
func TestCreateOrGetReviewConcurrentSingleRow(t *testing.T) {
	s := openTemp(t)

	const n = 20
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			if _, err := s.CreateOrGetReview("/repo", "main", "feature", "abc123"); err != nil {
				t.Errorf("CreateOrGetReview: %v", err)
			}
		}()
	}
	wg.Wait()

	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM reviews`).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 review row, got %d", count)
	}
}

// Deleting a review must cascade to its comments — verifies foreign_keys is
// enforced on whatever connection the delete runs on.
func TestDeleteReviewCascadesComments(t *testing.T) {
	s := openTemp(t)

	rev, err := s.CreateOrGetReview("/repo", "main", "feature", "abc123")
	if err != nil {
		t.Fatalf("CreateOrGetReview: %v", err)
	}
	if _, err := s.AddComment(Comment{ReviewID: rev.ID, FilePath: "a.go", StartLine: 1, EndLine: 1, Type: "nit", Body: "x"}); err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	if err := s.DeleteReview(rev.ID); err != nil {
		t.Fatalf("DeleteReview: %v", err)
	}

	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM comments WHERE review_id=?`, rev.ID).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected comments to cascade-delete, %d remain", count)
	}
}
