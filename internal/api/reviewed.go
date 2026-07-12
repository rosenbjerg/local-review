package api

import (
	"crypto/sha256"
	"encoding/hex"

	"local-review/internal/git"
	"local-review/internal/store"
)

// annotateReviewedFiles drops any reviewed-file mark whose content changed since
// it was set — re-verifying the captured fingerprint against the current file so
// a later edit reverts it to unread. A mark with no fingerprint can't be checked
// and stays reviewed.
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

// reviewedMarkHolds reports whether a mark still matches its content. An empty
// captured hash means nothing was fingerprinted, so it holds; otherwise the
// current same-side content must re-hash equal (a deleted/unreadable file hashes
// to "" and so counts as changed).
func reviewedMarkHolds(repo *git.Repo, headRef string, f store.ReviewedFile) bool {
	if f.ContentHash == "" {
		return true
	}
	return fileContentHash(repo, headRef, f.Path, f.Worktree) == f.ContentHash
}

// fileContentHash hashes a file's new-side content — the working tree when
// worktree is set, else the content at headRef — or "" when it can't be read.
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
