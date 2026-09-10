package api

import (
	"local-review/internal/review"
	"local-review/internal/store"
)

// annotateReview derives the live view of a stored review. The marks are read here rather
// than inside the derivation, so the domain pass needs no database; a failed read passes
// nil, which leaves the stored marks standing instead of dropping every one of them.
func (s *Server) annotateReview(rev *store.Review) {
	marks, err := s.Store.ListReviewedFilesFull(rev.ID)
	if err != nil {
		marks = nil
	}
	review.Annotate(rev, marks)
}
