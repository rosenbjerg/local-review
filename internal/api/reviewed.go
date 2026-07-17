package api

import (
	"crypto/sha256"
	"encoding/hex"

	"local-review/internal/git"
	"local-review/internal/store"
)

func (s *Server) annotateReviewedFiles(review *store.Review) {
	if len(review.ReviewedFiles) == 0 {
		return
	}
	files, err := s.Store.ListReviewedFilesFull(review.ID)
	if err != nil {
		return // best-effort: leave the stored marks as-is
	}
	repo := git.New(review.RepoPath)
	kept := []string{}
	for _, f := range files {
		if reviewedMarkHolds(repo, review.HeadRef, f) {
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
func reviewedMarkHolds(repo *git.Repo, headRef string, f store.ReviewedFile) bool {
	if f.ContentHash == "" {
		return true
	}
	return fileContentHash(repo, headRef, f.Path, f.Worktree, f.Indexed) == f.ContentHash
}

func fileContentHash(repo *git.Repo, headRef, path string, worktree, indexed bool) string {
	var content string
	var err error
	switch {
	case indexed:
		content, err = repo.IndexFile(path)
	case worktree:
		content, err = repo.WorktreeFile(path)
	default:
		content, err = repo.FileContent(headRef, path)
	}
	if err != nil {
		// Unreadable side (deleted file, etc.) — a sentinel that reverts if the
		// file later returns, rather than "" which would pin it reviewed forever.
		return absentContentHash
	}
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}
