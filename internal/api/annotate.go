package api

import (
	"fmt"
	"strings"

	"local-review/internal/git"
	"local-review/internal/store"
)

func (s *Server) annotateReview(review *store.Review) {
	repo := git.New(review.RepoPath)
	// Both halves read absence as staleness, which holds only while the repo itself is
	// readable — so probe once and, if it isn't, leave the stored state standing.
	if err := annotationBlocker(repo, review); err != nil {
		review.AnnotationError = err.Error()
		return
	}
	// One cache for both halves, warmed before either runs: they read the same files from the same sides.
	cache := newContentCache(repo, review.HeadRef)
	reviewed, err := s.Store.ListReviewedFilesFull(review.ID)
	if err != nil {
		reviewed = nil // best-effort: leave the stored marks as-is
	}
	warmCache(cache, review.Comments, reviewed)

	if len(review.Comments) > 0 {
		annotateComments(repo, review.HeadRef, review.Comments, cache)
	}
	s.annotateReviewedFiles(review, reviewed, cache)
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

// annotationBlocker reports why staleness can't be judged, or nil when it can.
func annotationBlocker(repo *git.Repo, review *store.Review) error {
	if !isGitRepo(review.RepoPath) {
		return fmt.Errorf("%s can no longer be read — the repository may have been moved, renamed, or deleted", review.RepoPath)
	}
	// A head that won't resolve fails every head-side read identically.
	if _, err := repo.ResolveSHA(review.HeadRef); err != nil {
		return fmt.Errorf("branch %s no longer resolves — it may have been deleted, renamed, or is mid-rebase", review.HeadRef)
	}
	return nil
}

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
		annotateComment(c, read)
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

// contentCache reads file content once per (side, path), warming the two git-backed sides
// in one command each: a review read runs continuously while an agent works, and spawn is the cost.
type contentCache struct {
	repo    *git.Repo
	headRef string
	sides   map[store.Side]map[string]*contentEntry
}

type contentEntry struct {
	content string
	ok      bool
	// split lazily, once, however many comments the file carries
	lines []string
	split bool
}

func newContentCache(repo *git.Repo, headRef string) *contentCache {
	return &contentCache{repo: repo, headRef: headRef, sides: map[store.Side]map[string]*contentEntry{}}
}

func (c *contentCache) side(s store.Side) map[string]*contentEntry {
	if c.sides[s] == nil {
		c.sides[s] = map[string]*contentEntry{}
	}
	return c.sides[s]
}

// spec is the `<ref>:<path>` form cat-file and `git show` share; the working tree has none and reads per file.
func (c *contentCache) spec(path string, s store.Side) string {
	if s == store.SideIndex {
		return ":" + path
	}
	return c.headRef + ":" + path
}

// warm prefetches one object-database side in a single command; a failed batch leaves the
// cache cold, not poisoned, so entry() falls back to the per-file read.
func (c *contentCache) warm(paths []string, s store.Side) {
	if s == store.SideWorktree || len(paths) == 0 {
		return
	}
	specs := make([]string, 0, len(paths))
	for _, p := range paths {
		specs = append(specs, c.spec(p, s))
	}
	objs, err := c.repo.BatchObjects(specs)
	if err != nil {
		return
	}
	side := c.side(s)
	for _, p := range paths {
		if _, seeded := side[p]; seeded {
			continue
		}
		// The batch ran, so an unanswered spec is genuinely absent; record that too, or every
		// missing file still costs a process to rediscover.
		if content, found := objs[c.spec(p, s)]; found {
			side[p] = &contentEntry{content: content, ok: true}
		} else {
			side[p] = &contentEntry{ok: false}
		}
	}
}

func (c *contentCache) entry(path string, s store.Side) *contentEntry {
	side := c.side(s)
	if e, ok := side[path]; ok {
		return e
	}
	content, err := readSide(c.repo, c.headRef, path, s)
	e := &contentEntry{content: content, ok: err == nil}
	if err != nil {
		e.content = ""
	}
	side[path] = e
	return e
}

func (c *contentCache) read(path string, s store.Side) (string, bool) {
	e := c.entry(path, s)
	return e.content, e.ok
}

// lines is read() split for snippet matching, memoised on the entry.
func (c *contentCache) lines(path string, s store.Side) ([]string, bool) {
	e := c.entry(path, s)
	if !e.ok {
		return nil, false
	}
	if !e.split {
		e.lines, e.split = splitLines(e.content), true
	}
	return e.lines, true
}

// annotateComment snippet-matches; a comment with no snippet (a line-0 file comment) stays current.
func annotateComment(c *store.Comment, read func(string) ([]string, bool)) {
	markCurrent(c)

	snippet := strings.TrimRight(c.Snippet, "\n")
	if strings.TrimSpace(snippet) == "" {
		return
	}
	lines, ok := read(c.FilePath)
	if !ok {
		markOutdated(c)
		return
	}
	snip := strings.Split(snippet, "\n")
	if matchAt(lines, c.StartLine-1, snip) {
		return
	}
	// Relocate only on an unambiguous hit; several matches read as outdated.
	starts := findMatches(lines, snip)
	if len(starts) == 1 {
		markMoved(c, "", starts[0]+1, starts[0]+len(snip)) // same-file relocation
		return
	}
	markOutdated(c)
}

func matchAt(lines []string, start int, snip []string) bool {
	if start < 0 || start+len(snip) > len(lines) {
		return false
	}
	for i, s := range snip {
		if lines[start+i] != s {
			return false
		}
	}
	return true
}

func findMatches(lines, snip []string) []int {
	var out []int
	for i := 0; i+len(snip) <= len(lines); i++ {
		if matchAt(lines, i, snip) {
			out = append(out, i)
		}
	}
	return out
}

// Drops one trailing newline so numbering lines up with the diff; an off-by-one here misaligns every snippet.
func splitLines(content string) []string {
	return strings.Split(strings.TrimSuffix(content, "\n"), "\n")
}

// captureSnippet reads the range from the side annotateComment will later compare against;
// best-effort, "" when the file or start is out of reach.
func captureSnippet(repo *git.Repo, headRef, path string, start, end int, side store.Side) string {
	if repo == nil || start <= 0 {
		return ""
	}
	content, err := readSide(repo, headRef, path, side)
	if err != nil {
		return ""
	}
	lines := splitLines(content)
	if start > len(lines) {
		return ""
	}
	if end > len(lines) {
		end = len(lines)
	}
	if end < start {
		end = start
	}
	return strings.Join(lines[start-1:end], "\n")
}
