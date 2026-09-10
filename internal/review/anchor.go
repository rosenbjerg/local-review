// Tracking a head-anchored comment from the commit it was written at to head, by diffing
// the two and mapping its range through the hunks. This is what tells a real move from the
// same lines happening to reappear elsewhere, which is all snippet matching can see.
package review

import (
	"local-review/internal/git"
	"local-review/internal/store"
)

// annotateComments checks each comment against the side it was anchored to; the wrong side never matches.
func annotateComments(repo *git.Repo, headRef string, comments []store.Comment, cache *contentCache) {
	headSHA, _ := repo.ResolveSHA(headRef)
	caches := &diffCaches{scoped: map[string]*fileDiffResult{}, whole: map[string]*fileDiffResult{}}
	// A sha with several comments reads one whole-tree diff instead of a scoped diff per path.
	wholePreferred := shasWithSeveralComments(comments, headSHA)
	for i := range comments {
		c := &comments[i]
		if diffTrackable(c, headSHA) {
			if annotateByDiff(repo, c, headRef, caches, wholePreferred[c.CommitSHA]) {
				continue
			}
		}
		read := func(path string) ([]string, bool) {
			return cache.lines(path, c.Side)
		}
		annotateBySnippet(c, read)
	}
}

// diffTrackable reports whether c can be tracked by diffing commit_sha against head, which
// unlike snippet matching tells a real move from the same lines reappearing elsewhere.
func diffTrackable(c *store.Comment, headSHA string) bool {
	return c.Side.IsHead() && c.StartLine > 0 && c.CommitSHA != "" && c.CommitSHA != headSHA
}

// shasWithSeveralComments reports the shas more than one diff-trackable comment is anchored to.
func shasWithSeveralComments(comments []store.Comment, headSHA string) map[string]bool {
	n := map[string]int{}
	for i := range comments {
		if c := &comments[i]; diffTrackable(c, headSHA) {
			n[c.CommitSHA]++
		}
	}
	out := make(map[string]bool, len(n))
	for sha, count := range n {
		out[sha] = count > 1
	}
	return out
}

type fileDiffResult struct {
	files []git.FileDiff
	err   error
	// Lazily built: the whole-tree diff is consulted once per comment, and a linear scan would be quadratic.
	byOldPath map[string]*git.FileDiff
}

// entry looks up by OLD-side path, the side a head-anchored comment is keyed to; matching
// NewPath would pick up an unrelated file renamed onto this path.
func (res *fileDiffResult) entry(path string) *git.FileDiff {
	if res.byOldPath == nil {
		res.byOldPath = make(map[string]*git.FileDiff, len(res.files))
		for i := range res.files {
			// First wins.
			if _, dup := res.byOldPath[res.files[i].OldPath]; !dup {
				res.byOldPath[res.files[i].OldPath] = &res.files[i]
			}
		}
	}
	return res.byOldPath[path]
}

// diffCaches memoizes, per review read, the path-scoped diff per (sha, path) and the whole-tree diff per sha.
type diffCaches struct {
	scoped map[string]*fileDiffResult // key: commit_sha + "\x00" + path
	whole  map[string]*fileDiffResult // key: commit_sha
}

// scopedEntry returns path's entry in `git diff <sha> head -- path`: nil if unchanged, ok=false on git error.
func (dc *diffCaches) scopedEntry(repo *git.Repo, sha, head, path string) (fd *git.FileDiff, ok bool) {
	key := sha + "\x00" + path
	res := dc.scoped[key]
	if res == nil {
		files, err := repo.DiffFile(sha, head, path)
		res = &fileDiffResult{files: files, err: err}
		dc.scoped[key] = res
	}
	if res.err != nil {
		return nil, false
	}
	return res.entry(path), true
}

// wholeEntry returns path's entry in the whole-tree `git diff <sha> head`, which pairs renames.
func (dc *diffCaches) wholeEntry(repo *git.Repo, sha, head, path string) (fd *git.FileDiff, ok bool) {
	res := dc.whole[sha]
	if res == nil {
		files, err := repo.Diff(sha, head)
		res = &fileDiffResult{files: files, err: err}
		dc.whole[sha] = res
	}
	if res.err != nil {
		return nil, false
	}
	return res.entry(path), true
}

// Every anchor decision goes through these, so AnchorStatus and the Current* fields are always set together.
func markCurrent(c *store.Comment) {
	c.AnchorStatus, c.CurrentStartLine, c.CurrentEndLine, c.CurrentFilePath = store.AnchorCurrent, 0, 0, ""
}
func markOutdated(c *store.Comment) {
	c.AnchorStatus, c.CurrentStartLine, c.CurrentEndLine, c.CurrentFilePath = store.AnchorOutdated, 0, 0, ""
}

// markMoved records a shift; path is the new file when the move followed a rename, "" otherwise.
func markMoved(c *store.Comment, path string, start, end int) {
	c.AnchorStatus, c.CurrentStartLine, c.CurrentEndLine, c.CurrentFilePath = store.AnchorMoved, start, end, path
}

// annotateByDiff tracks a head-anchored comment from commit_sha to head: a path-scoped diff,
// escalating to the whole-tree diff when the file reads as deleted. False → snippet matching.
func annotateByDiff(repo *git.Repo, c *store.Comment, headRef string, caches *diffCaches, preferWhole bool) bool {
	if preferWhole {
		fd, ok := caches.wholeEntry(repo, c.CommitSHA, headRef, c.FilePath)
		if !ok {
			return false
		}
		return annotateFromEntry(c, fd)
	}
	fd, ok := caches.scopedEntry(repo, c.CommitSHA, headRef, c.FilePath)
	if !ok {
		return false
	}
	if fd == nil {
		markCurrent(c) // untouched between commit_sha and head
		return true
	}
	if fd.Status == git.FileDeleted {
		// The pathspec reports a rename as a bare deletion; escalate to tell the two apart.
		return annotateDeletedOrRenamed(repo, c, headRef, caches)
	}
	if fd.Binary || len(fd.Hunks) == 0 {
		return false // binary or mode-only change — let snippet matching decide
	}
	return mapContiguous(c, fd.Hunks, "") // same-file modification
}

// annotateFromEntry decides from a whole-tree entry, where a deletion is real and needs
// no escalation; false falls back to snippet matching.
func annotateFromEntry(c *store.Comment, fd *git.FileDiff) bool {
	if fd == nil {
		markCurrent(c) // untouched between commit_sha and head
		return true
	}
	if fd.Binary {
		return false // no text to map — let snippet matching decide
	}
	switch fd.Status {
	case git.FileDeleted:
		markOutdated(c)
		return true
	case git.FileRenamed:
		// A pure R100 rename carries no hunks, so the lines map 1:1.
		return mapContiguous(c, fd.Hunks, fd.NewPath)
	}
	if len(fd.Hunks) == 0 {
		return false // mode-only change — snippet matching decides
	}
	return mapContiguous(c, fd.Hunks, "")
}

func annotateDeletedOrRenamed(repo *git.Repo, c *store.Comment, headRef string, caches *diffCaches) bool {
	fd, ok := caches.wholeEntry(repo, c.CommitSHA, headRef, c.FilePath)
	if !ok {
		return false
	}
	if fd == nil || fd.Status != git.FileRenamed {
		markOutdated(c) // genuinely deleted between commit_sha and head
		return true
	}
	if fd.Binary {
		return false
	}
	return mapContiguous(c, fd.Hunks, fd.NewPath) // follow the rename (R100 has no hunks → 1:1)
}

// mapContiguous maps c's range through hunks: every line must survive and stay contiguous,
// else the block was edited (outdated) rather than shifted; newPath relocates a rename.
func mapContiguous(c *store.Comment, hunks []git.Hunk, newPath string) bool {
	ns, alive := git.MapOldLine(hunks, c.StartLine)
	if !alive {
		markOutdated(c)
		return true
	}
	// Stop at the hunks' old extent: beyond it lines map by a constant offset, and an API
	// client can send any EndLine.
	limit := c.EndLine
	if ext := git.HunksOldExtent(hunks); ext < limit {
		limit = ext
	}
	prev := ns
	for l := c.StartLine + 1; l <= limit; l++ {
		nl, ok := git.MapOldLine(hunks, l)
		if !ok || nl != prev+1 {
			markOutdated(c)
			return true
		}
		prev = nl
	}
	// Contiguous throughout, so the end tracks the start by the range's span.
	end := ns + (c.EndLine - c.StartLine)
	if newPath == "" && ns == c.StartLine {
		markCurrent(c)
	} else {
		markMoved(c, newPath, ns, end)
	}
	return true
}
