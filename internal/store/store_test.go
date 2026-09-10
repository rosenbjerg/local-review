package store

import (
	"path/filepath"
	"sync"
	"testing"
	"time"
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

// Pruning a review must cascade to its comments — verifies foreign_keys is
// enforced on whatever connection the delete runs on.
func TestPruneDraftsCascadesComments(t *testing.T) {
	s := openTemp(t)

	rev, err := s.CreateOrGetReview("/repo", "main", "feature", "abc123")
	if err != nil {
		t.Fatalf("CreateOrGetReview: %v", err)
	}
	if _, err := s.AddComment(Comment{ReviewID: rev.ID, FilePath: "a.go", StartLine: 1, EndLine: 1, Type: "nit", Body: "x"}); err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	// Backdate the row so the cutoff catches it; the cascade, not the cutoff, is the point.
	if _, err := s.db.Exec(`UPDATE reviews SET updated_at='2000-01-01T00:00:00Z' WHERE id=?`, rev.ID); err != nil {
		t.Fatalf("backdate: %v", err)
	}
	if n, err := s.PruneDrafts(24 * time.Hour); err != nil || n != 1 {
		t.Fatalf("PruneDrafts = %d, %v; want 1, nil", n, err)
	}

	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM comments WHERE review_id=?`, rev.ID).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected comments to cascade-delete, %d remain", count)
	}
}
