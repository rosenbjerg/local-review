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

// An empty captured hash (older/unfingerprinted rows) always holds; otherwise the
// current same-side content must re-hash equal — a deleted/unreadable file hashes
// to "" and so counts as changed.
func reviewedMarkHolds(repo *git.Repo, headRef string, f store.ReviewedFile) bool {
	if f.ContentHash == "" {
		return true
	}
	return fileContentHash(repo, headRef, f.Path, f.Worktree) == f.ContentHash
}

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
