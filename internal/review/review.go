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
// marks untouched, which is what a failed store read should do.
func Annotate(rev *store.Review, marks []store.ReviewedFile) {
	repo := git.New(rev.RepoPath)
	// Both halves read absence as staleness, which holds only while the repo itself is
	// readable — so probe once and, if it isn't, leave the stored state standing.
	if err := blocker(repo, rev); err != nil {
		rev.AnnotationError = err.Error()
		return
	}
	// One cache for both halves, warmed before either runs: they read the same files from the same sides.
	cache := newContentCache(repo, rev.HeadRef)
	warmCache(cache, rev.Comments, marks)

	if len(rev.Comments) > 0 {
		annotateComments(repo, rev.HeadRef, rev.Comments, cache)
	}
	annotateReviewedFiles(rev, marks, cache)
}

// AnnotateComment recomputes one comment's anchor for a mutation's response, so a client that
// swaps the returned comment into its list sees the same staleness a review read reports.
// One comment, so a cache warm-up would cost more than it saves.
func AnnotateComment(repo *git.Repo, headRef string, c *store.Comment) *store.Comment {
	if repo == nil {
		return c
	}
	cs := []store.Comment{*c}
	annotateComments(repo, headRef, cs, newContentCache(repo, headRef))
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

// blocker reports why staleness can't be judged, or nil when it can. An unreadable repo is
// not a stale review: without this every comment would read as outdated at HTTP 200.
func blocker(repo *git.Repo, rev *store.Review) error {
	if !git.IsRepo(rev.RepoPath) {
		return fmt.Errorf("%s can no longer be read — the repository may have been moved, renamed, or deleted", rev.RepoPath)
	}
	// A head that won't resolve fails every head-side read identically.
	if _, err := repo.ResolveSHA(rev.HeadRef); err != nil {
		return fmt.Errorf("branch %s no longer resolves — it may have been deleted, renamed, or is mid-rebase", rev.HeadRef)
	}
	return nil
}
