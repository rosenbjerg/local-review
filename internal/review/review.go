// Package review derives a review's live state from the repository it was written against:
// which comments still point at the code they were anchored to, and which reviewed marks
// still hold. None of it is persisted — every read recomputes it from the stored anchor.
package review

import (
	"fmt"

	"local-review/internal/git"
	"local-review/internal/store"
)

// Annotate fills in rev's derived fields: each comment's anchor status and the reviewed
// marks that survive a re-hash. marks are the stored fingerprints; a nil slice leaves the
// marks untouched, which is what a failed store read should do. diffs may be nil.
func Annotate(rev *store.Review, marks []store.ReviewedFile, diffs *DiffCache) {
	repo := git.New(rev.RepoPath)
	// Both halves read absence as staleness, which holds only while the repo itself is
	// readable — so probe once and, if it isn't, leave the stored state standing. The probe
	// resolves head, which is the one sha the rest of the pass needs.
	headSHA, err := blocker(repo, rev)
	if err != nil {
		rev.AnnotationError = err.Error()
		return
	}
	// One cache for both halves, warmed before either runs: they read the same files from the same sides.
	cache := newContentCache(repo, rev.HeadRef)
	warmCache(cache, rev.Comments, marks)

	if len(rev.Comments) > 0 {
		annotateComments(repo, headSHA, rev.Comments, cache, diffs)
	}
	annotateReviewedFiles(rev, marks, cache)
}

// AnnotateComment recomputes one comment's anchor for a mutation's response, so a client that
// swaps the returned comment into its list sees the same staleness a review read reports.
// One comment, so neither a cache warm-up nor the cross-read diff cache would pay for itself.
// headSHA may be empty, for the callers that had no reason to resolve head themselves.
func AnnotateComment(repo *git.Repo, headRef, headSHA string, c *store.Comment) *store.Comment {
	if repo == nil {
		return c
	}
	if headSHA == "" {
		headSHA, _ = repo.ResolveSHA(headRef)
	}
	cs := []store.Comment{*c}
	annotateComments(repo, headSHA, cs, newContentCache(repo, headRef), nil)
	return &cs[0]
}

// warmCache prefetches, per side, every path either half may read — diff-tracked comments
// included, since they can fall back to snippet matching.
func warmCache(cache *contentCache, comments []store.Comment, reviewed []store.ReviewedFile) {
	byside := map[store.Side][]string{}
	add := func(path string, side store.Side) {
		if path == "" {
			return
		}
		byside[side] = append(byside[side], path)
	}
	for i := range comments {
		c := &comments[i]
		if c.StartLine > 0 { // a line-0 comment has no snippet to check
			add(c.FilePath, c.Side)
		}
	}
	for _, f := range reviewed {
		if f.ContentHash != "" { // a legacy unfingerprinted row is never re-read
			add(f.Path, f.Side)
		}
	}
	for side, paths := range byside {
		cache.warm(paths, side)
	}
}

// blocker reports why staleness can't be judged, or the resolved head sha when it can. An
// unreadable repo is not a stale review: without this every comment would read as outdated
// at HTTP 200.
func blocker(repo *git.Repo, rev *store.Review) (string, error) {
	if !git.IsRepo(rev.RepoPath) {
		return "", fmt.Errorf("%s can no longer be read — the repository may have been moved, renamed, or deleted", rev.RepoPath)
	}
	// A head that won't resolve fails every head-side read identically.
	sha, err := repo.ResolveSHA(rev.HeadRef)
	if err != nil {
		return "", fmt.Errorf("branch %s no longer resolves — it may have been deleted, renamed, or is mid-rebase", rev.HeadRef)
	}
	return sha, nil
}
