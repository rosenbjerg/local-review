package api

import (
	"strings"

	"local-review/internal/git"
	"local-review/internal/store"
)

func (s *Server) annotateReview(review *store.Review) {
	if len(review.Comments) > 0 {
		annotateComments(git.New(review.RepoPath), review.HeadRef, review.Comments)
	}
	s.annotateReviewedFiles(review)
}

// A comment's staleness is checked against the side it was anchored to: the index
// (staged), the on-disk working tree, or else headRef — checking a snippet against
// the wrong side would never match and read as outdated.
func annotateComments(repo *git.Repo, headRef string, comments []store.Comment) {
	readHead := fileReader(func(path string) (string, error) {
		return repo.FileContent(headRef, path)
	})
	readWorktree := fileReader(repo.WorktreeFile)
	readIndex := fileReader(repo.IndexFile)
	headSHA, _ := repo.ResolveSHA(headRef)
	caches := &diffCaches{scoped: map[string]*fileDiffResult{}, whole: map[string]*fileDiffResult{}}
	for i := range comments {
		c := &comments[i]
		// Prefer diff-based tracking (commit_sha → head): snippet matching can't
		// tell a genuine move from a coincidental reappearance of the same lines.
		// Only for head-anchored comments — working-tree/index sides snippet-match.
		if !c.Worktree && !c.Indexed && c.StartLine > 0 && c.CommitSHA != "" && c.CommitSHA != headSHA {
			if annotateByDiff(repo, c, headRef, caches) {
				continue
			}
		}
		read := readHead
		if c.Indexed {
			read = readIndex
		} else if c.Worktree {
			read = readWorktree
		}
		annotateComment(c, read)
	}
}

type fileDiffResult struct {
	files []git.FileDiff
	err   error
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
	return findEntry(res.files, path), true
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
	return findEntry(res.files, path), true
}

// findEntry locates the file by its OLD-side path — the side a head-anchored comment
// is keyed to. A file that exists at commit_sha is always on the old side, so it can
// never appear only as a NewPath; matching NewPath would just pick up an unrelated
// file coincidentally renamed onto this path.
func findEntry(files []git.FileDiff, path string) *git.FileDiff {
	for i := range files {
		if files[i].OldPath == path {
			return &files[i]
		}
	}
	return nil
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
func annotateByDiff(repo *git.Repo, c *store.Comment, headRef string, caches *diffCaches) bool {
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
	prev := ns
	for l := c.StartLine + 1; l <= c.EndLine; l++ {
		nl, ok := git.MapOldLine(hunks, l)
		if !ok || nl != prev+1 {
			markOutdated(c)
			return true
		}
		prev = nl
	}
	if newPath == "" && ns == c.StartLine {
		markCurrent(c)
	} else {
		markMoved(c, newPath, ns, prev)
	}
	return true
}

func fileReader(fetch func(string) (string, error)) func(string) ([]string, bool) {
	cache := map[string][]string{}
	return func(path string) ([]string, bool) {
		if lines, ok := cache[path]; ok {
			return lines, lines != nil
		}
		content, err := fetch(path)
		if err != nil {
			cache[path] = nil
			return nil, false
		}
		lines := splitLines(content)
		cache[path] = lines
		return lines, true
	}
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
func captureSnippet(repo *git.Repo, headRef, path string, start, end int, worktree, indexed bool) string {
	if repo == nil || start <= 0 {
		return ""
	}
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
