package api

import (
	"crypto/sha256"
	"encoding/hex"

	"local-review/internal/store"
)

// files and cache come from annotateReview, which already read and warmed them for the comment half.
func (s *Server) annotateReviewedFiles(review *store.Review, files []store.ReviewedFile, cache *contentCache) {
	if len(review.ReviewedFiles) == 0 || files == nil {
		return
	}
	kept := []string{}
	for _, f := range files {
		if reviewedMarkHolds(cache, f) {
			kept = append(kept, f.Path)
		}
	}
	review.ReviewedFiles = kept
}

// absentContentHash is stored when the marked side couldn't be read (a reviewed deletion);
// unlike "" — a legacy row that always holds — it reverts once the file reappears.
const absentContentHash = "absent"

// An empty hash (legacy row) always holds; otherwise the same-side content must re-hash equal.
func reviewedMarkHolds(cache *contentCache, f store.ReviewedFile) bool {
	if f.ContentHash == "" {
		return true
	}
	return hashSide(cache, f.Path, f.Side) == f.ContentHash
}

func hashSide(cache *contentCache, path string, side store.Side) string {
	content, ok := cache.read(path, side)
	if !ok {
		return absentContentHash
	}
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}
