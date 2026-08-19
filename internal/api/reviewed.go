package api

import (
	"crypto/sha256"
	"encoding/hex"

	"local-review/internal/store"
)

// files and cache are supplied by annotateReview, which already read the rows and
// warmed the content: both halves of a review read want the same files from the same
// sides, so reading them here again would double the git work.
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

// Sentinel stored when the marked side couldn't be read (a reviewed deletion has
// no new-side content). It never equals a real 64-hex-char hash, so the mark holds
// only while the file stays unreadable and reverts once it reappears with content.
// Distinct from "" — a legacy, pre-fingerprint row that always holds.
const absentContentHash = "absent"

// An empty captured hash (older/unfingerprinted rows) always holds; otherwise the
// current same-side content must re-hash equal. A deleted/unreadable file hashes to
// the absent sentinel, so it holds only against another absent read.
func reviewedMarkHolds(cache *contentCache, f store.ReviewedFile) bool {
	if f.ContentHash == "" {
		return true
	}
	return hashSide(cache, f.Path, f.Worktree, f.Indexed) == f.ContentHash
}

func hashSide(cache *contentCache, path string, worktree, indexed bool) string {
	content, ok := cache.read(path, worktree, indexed)
	if !ok {
		// Unreadable side (deleted file, etc.) — a sentinel that reverts if the
		// file later returns, rather than "" which would pin it reviewed forever.
		return absentContentHash
	}
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}
