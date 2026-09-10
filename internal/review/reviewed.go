// Reviewed marks: a mark holds only while the content it was taken against is unchanged,
// so every read re-hashes the same side the mark was captured on.
package review

import (
	"crypto/sha256"
	"encoding/hex"

	"local-review/internal/git"
	"local-review/internal/store"
)

// FingerprintFiles hashes each path on the given side, warming the whole batch in one git
// command. An unreadable path gets absentContentHash, which is how a reviewed deletion is
// recorded; a blank path is skipped.
func FingerprintFiles(repo *git.Repo, headRef string, paths []string, side store.Side) map[string]string {
	cache := newContentCache(repo, headRef)
	cache.warm(paths, side)
	out := make(map[string]string, len(paths))
	for _, p := range paths {
		if p == "" {
			continue
		}
		out[p] = hashSide(cache, p, side)
	}
	return out
}

// marks and cache come from Annotate, which already read and warmed them for the comment half.
func annotateReviewedFiles(rev *store.Review, marks []store.ReviewedFile, cache *contentCache) {
	if len(rev.ReviewedFiles) == 0 || marks == nil {
		return
	}
	kept := []string{}
	for _, f := range marks {
		if reviewedMarkHolds(cache, f) {
			kept = append(kept, f.Path)
		}
	}
	rev.ReviewedFiles = kept
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
