package api

import (
	"crypto/sha256"
	"encoding/hex"

	"local-review/internal/git"
	"local-review/internal/store"
)

// annotateReviewedFiles drops from review.ReviewedFiles any file whose content
// has changed since it was marked reviewed, so new changes revert it to unread.
// Derived state, like comment anchoring: the stored flag is never trusted on its
// own — its captured fingerprint is re-verified against the current file on read.
// A mark with no captured fingerprint (older rows, or a mark-time read failure)
// can't be checked and stays reviewed.
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

// reviewedMarkHolds reports whether a reviewed file still matches the content it
// was reviewed against. An empty captured hash means no fingerprint was recorded
// — nothing to compare, so the mark holds. Otherwise the current content of the
// same side (working tree vs head) must hash to the same value; an unreadable
// file (e.g. deleted since) hashes to "" and so counts as changed.
func reviewedMarkHolds(repo *git.Repo, headRef string, f store.ReviewedFile) bool {
	if f.ContentHash == "" {
		return true
	}
	return fileContentHash(repo, headRef, f.Path, f.Worktree) == f.ContentHash
}

// fileContentHash returns a fingerprint of a file's new-side content, or "" when
// it can't be read. worktree selects the on-disk working-tree content (an
// uncommitted diff's new side); otherwise the content at headRef.
func fileContentHash(repo *git.Repo, headRef, path string, worktree bool) string {
	var content string
	var err error
	if worktree {
		content, err = repo.WorktreeFile(path)
	} else {
		content, err = repo.FileContent(headRef, path)
	}
	if err != nil {
		return ""
	}
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}
