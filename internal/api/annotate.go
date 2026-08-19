package api

import (
	"fmt"
	"strings"

	"local-review/internal/git"
	"local-review/internal/store"
)

func (s *Server) annotateReview(review *store.Review) {
	repo := git.New(review.RepoPath)
	// Both halves below derive their answer from *reading the repo*, and both read
	// absence as staleness: a comment whose side won't open is "outdated", a reviewed
	// file whose content won't hash reverts to unread. That inference only holds when
	// the repo itself is readable. Move the repo directory — an ordinary thing to do
	// — and every per-file read fails at once, so the reviewer is shown a review where
	// every comment is stale and nothing is reviewed, at HTTP 200, with nothing
	// saying why. Probe once and decline to annotate instead, so the state on screen
	// is the stored one and the banner explains that it isn't being checked.
	if err := annotationBlocker(repo, review); err != nil {
		review.AnnotationError = err.Error()
		return
	}
	// One cache for both halves, warmed per side before either runs: they want the
	// same files from the same sides, and read per file they cost a git process each.
	cache := newContentCache(repo, review.HeadRef)
	reviewed, err := s.Store.ListReviewedFilesFull(review.ID)
	if err != nil {
		reviewed = nil // best-effort, as before: leave the stored marks as-is
	}
	warmCache(cache, review.Comments, reviewed)

	if len(review.Comments) > 0 {
		annotateComments(repo, review.HeadRef, review.Comments, cache)
	}
	s.annotateReviewedFiles(review, reviewed, cache)
}

// warmCache prefetches, per object-database side, every path either half is about to
// read. Comments tracked by diff never reach a content read, but they can fall back
// to snippet matching, so their paths are included: over-fetching a path costs
// nothing extra in a batch, while missing one costs a whole process.
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
	// A head that won't resolve fails every head-side read identically, so it's the
	// same defect wearing a different hat (a deleted branch, or a rebase in flight).
	if _, err := repo.ResolveSHA(review.HeadRef); err != nil {
		return fmt.Errorf("branch %s no longer resolves — it may have been deleted, renamed, or is mid-rebase", review.HeadRef)
	}
	return nil
}

// A comment's staleness is checked against the side it was anchored to: the index
// (staged), the on-disk working tree, or else headRef — checking a snippet against
// the wrong side would never match and read as outdated.
func annotateComments(repo *git.Repo, headRef string, comments []store.Comment, cache *contentCache) {
	headSHA, _ := repo.ResolveSHA(headRef)
	caches := &diffCaches{scoped: map[string]*fileDiffResult{}, whole: map[string]*fileDiffResult{}}
	// The path-scoped diff is one process per path, so a sha with several comments
	// on different files pays it several times over — the same per-file spawn cost
	// the content reads just stopped paying, and after any new commit *every* comment
	// takes this path at once. One whole-tree diff answers all of them, and it's
	// already cached per sha because the rename escalation needs it. Below the
	// threshold the scoped diff is still cheaper (it reads one file's patch, not the
	// branch's), which is the single-comment add-comment response.
	wholePreferred := shasWithSeveralComments(comments, headSHA)
	for i := range comments {
		c := &comments[i]
		// Prefer diff-based tracking (commit_sha → head): snippet matching can't
		// tell a genuine move from a coincidental reappearance of the same lines.
		// Only for head-anchored comments — working-tree/index sides snippet-match.
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

// A head-anchored comment with a commit_sha behind head can be tracked precisely by
// diffing that commit against head, which snippet matching can't do (it can't tell a
// real move from the same lines reappearing elsewhere).
func diffTrackable(c *store.Comment, headSHA string) bool {
	return c.Side.IsHead() && c.StartLine > 0 && c.CommitSHA != "" && c.CommitSHA != headSHA
}

// shasWithSeveralComments reports the commit shas that more than one diff-trackable
// comment is anchored to — the ones where a single whole-tree diff beats one
// path-scoped diff per file.
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
	// Lazily built index of files by old-side path. The whole-tree diff can hold
	// every file the branch touched, and it's consulted once per comment, so the
	// linear scan findEntry does would be quadratic on a big review.
	byOldPath map[string]*git.FileDiff
}

// entry locates the file by its OLD-side path — the side a head-anchored comment is
// keyed to. A file that exists at commit_sha is always on the old side, so it can
// never appear only as a NewPath; matching NewPath would just pick up an unrelated
// file coincidentally renamed onto this path.
func (res *fileDiffResult) entry(path string) *git.FileDiff {
	if res.byOldPath == nil {
		res.byOldPath = make(map[string]*git.FileDiff, len(res.files))
		for i := range res.files {
			// First wins, matching findEntry's scan order.
			if _, dup := res.byOldPath[res.files[i].OldPath]; !dup {
				res.byOldPath[res.files[i].OldPath] = &res.files[i]
			}
		}
	}
	return res.byOldPath[path]
}

// diffCaches memoizes, per review read: the path-scoped diff per (commit_sha, path)
// used for the common (unchanged/modified) case, and the whole-tree find-renames diff
// per commit_sha used only to resolve a rename hiding behind a deletion.
type diffCaches struct {
	scoped map[string]*fileDiffResult // key: commit_sha + "\x00" + path
	whole  map[string]*fileDiffResult // key: commit_sha
}

// scopedEntry returns path's entry in `git diff <sha> head -- path` (nil if the file
// is unchanged; ok=false on git error). Restricting to the path is cheap but reports
// a rename as a bare deletion, so the caller escalates to wholeEntry on a deletion.
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

// wholeEntry returns path's entry in the whole-tree `git diff <sha> head` (with rename
// detection), so a rename is paired to its new path.
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

// Route every anchor decision through these so AnchorStatus and the Current* fields
// are always assigned together (and CurrentFilePath cleared unless a rename set it).
func markCurrent(c *store.Comment) {
	c.AnchorStatus, c.CurrentStartLine, c.CurrentEndLine, c.CurrentFilePath = store.AnchorCurrent, 0, 0, ""
}
func markOutdated(c *store.Comment) {
	c.AnchorStatus, c.CurrentStartLine, c.CurrentEndLine, c.CurrentFilePath = store.AnchorOutdated, 0, 0, ""
}

// markMoved records a shift; path is the new file when the move followed a rename,
// "" for a same-file move.
func markMoved(c *store.Comment, path string, start, end int) {
	c.AnchorStatus, c.CurrentStartLine, c.CurrentEndLine, c.CurrentFilePath = store.AnchorMoved, start, end, path
}

// annotateByDiff tracks a head-anchored comment's range from commit_sha to head via
// git, two-tier: a cheap path-scoped diff for the common (unchanged/modified) case,
// escalating to a whole-tree find-renames diff only when the file is gone (a possible
// rename). Returns false to fall back to snippet matching (git error, binary file, or
// a modification with no textual hunks).
func annotateByDiff(repo *git.Repo, c *store.Comment, headRef string, caches *diffCaches, preferWhole bool) bool {
	// preferWhole: several comments share this sha, so the whole-tree diff (one
	// process, cached per sha) is read directly instead of a scoped diff per path.
	// It also pairs renames, so the deletion escalation below is already resolved.
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
		markCurrent(c) // untouched between commit_sha and head → still where it was
		return true
	}
	if fd.Status == git.FileDeleted {
		// The pathspec reports a rename as a bare deletion; the whole-tree diff pairs
		// it, so escalate to tell a real deletion (outdated) from a rename (follow it).
		return annotateDeletedOrRenamed(repo, c, headRef, caches)
	}
	if fd.Binary || len(fd.Hunks) == 0 {
		return false // binary or mode-only change — let snippet matching decide
	}
	return mapContiguous(c, fd.Hunks, "") // same-file modification
}

// annotateFromEntry decides a comment's anchor from its file's entry in the
// whole-tree diff, which has rename detection — so a deletion here is a real one and
// needs no escalation. Returns false to fall back to snippet matching.
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

// mapContiguous maps c's range through hunks: every line must survive and stay
// contiguous, else the block was edited (outdated) rather than merely shifted. A
// non-empty newPath relocates a move that followed a rename.
func mapContiguous(c *store.Comment, hunks []git.Hunk, newPath string) bool {
	ns, alive := git.MapOldLine(hunks, c.StartLine)
	if !alive {
		markOutdated(c)
		return true
	}
	// Only lines within the hunks' old-side extent can break contiguity; every line
	// beyond it maps 1:1 by a constant offset, so the tail is contiguous by
	// construction and we stop there. Without this bound an unbounded EndLine (an API
	// client can send any value) would spin MapOldLine billions of times on every
	// review read.
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
	// Contiguous throughout, so the end tracks the start by the range's own span
	// (== prev when the loop ran to EndLine).
	end := ns + (c.EndLine - c.StartLine)
	if newPath == "" && ns == c.StartLine {
		markCurrent(c)
	} else {
		markMoved(c, newPath, ns, end)
	}
	return true
}

// contentCache reads a review's file content once per (side, path), and warms the
// two git-backed sides in one command each.
//
// Both halves of a review read — comment staleness and reviewed-file fingerprints —
// need the same files' content from the same sides, and each used to spawn its own
// `git show` per path from its own private cache, so a file that was both commented
// and reviewed was read twice. That is one process per file, on every review read,
// and a review read happens on every comment/reply/reviewed mutation plus every tick
// of the ~1.5s filesystem poller — i.e. continuously while an agent works. Measured
// at 60 comments + 60 reviewed files it cost 0.95s per read. Process spawn is the
// whole of it, so batching the reads is the fix, and sharing the cache removes the
// double read.
type contentCache struct {
	repo    *git.Repo
	headRef string
	sides   map[store.Side]map[string]*contentEntry
}

type contentEntry struct {
	content string
	ok      bool
	// Snippet matching wants the file as lines, and a file with N comments on it
	// would otherwise re-split N times.
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

// spec is the `<ref>:<path>` form cat-file and `git show` share. The working tree has
// no such form — it isn't in the object database — so it reads per file, which costs
// no process anyway.
func (c *contentCache) spec(path string, s store.Side) string {
	if s == store.SideIndex {
		return ":" + path
	}
	return c.headRef + ":" + path
}

// warm prefetches paths for one object-database side in a single command. A batch
// that fails leaves the cache cold rather than poisoned: read() then falls back to
// the per-file call, so correctness never depends on the batch parser.
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
		// The batch ran, so a spec it didn't answer for is genuinely absent — record
		// that too, or every missing file would still cost a process to rediscover.
		// Except a non-blob, which BatchObjects deliberately omits; those are rare
		// enough to let fall through to the single-object path.
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

// lines is read() split for snippet matching, memoised on the entry so a file
// carrying several comments is split once.
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

// A comment with no captured snippet stays "current" — nothing to verify drift
// against (e.g. a line-0 media comment).
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
	// Relocate only on an unambiguous hit; multiple matches read as outdated
	// rather than guessing.
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

// Drops one trailing newline so numbering lines up with the diff (and the
// frontend) — an off-by-one here misaligns every snippet capture and match.
func splitLines(content string) []string {
	return strings.Split(strings.TrimSuffix(content, "\n"), "\n")
}

// Reads the range from the same side annotateComment later compares against — the
// index for a staged anchor, the working tree for an uncommitted anchor, else
// headRef — so the stored snippet matches. Best-effort: an unreadable file or
// out-of-range start yields "".
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
