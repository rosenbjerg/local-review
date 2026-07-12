package api

import (
	"strings"

	"local-review/internal/git"
	"local-review/internal/store"
)

// annotateReview fills in derived, never-persisted state on read: each comment's
// live anchor status and which reviewed-file marks still hold. Recomputed every
// read because the branch keeps moving.
func (s *Server) annotateReview(review *store.Review) {
	if len(review.Comments) > 0 {
		annotateComments(git.New(review.RepoPath), review.HeadRef, review.Comments)
	}
	s.annotateReviewedFiles(review)
}

// annotateComments annotates comments in place, reading each file at most once
// per side. Worktree comments compare to the on-disk content, the rest to headRef
// (else a working-tree snippet never matches head and reads as outdated).
func annotateComments(repo *git.Repo, headRef string, comments []store.Comment) {
	readHead := fileReader(func(path string) (string, error) {
		return repo.FileContent(headRef, path)
	})
	readWorktree := fileReader(repo.WorktreeFile)
	headSHA, _ := repo.ResolveSHA(headRef)
	diffCache := map[string]*fileDiffResult{}
	for i := range comments {
		c := &comments[i]
		// Prefer diff-based tracking (commit_sha → head): snippet matching can't
		// tell a genuine move from a coincidental reappearance of the same lines.
		if !c.Worktree && c.StartLine > 0 && c.CommitSHA != "" && c.CommitSHA != headSHA {
			if annotateByDiff(repo, c, headRef, diffCache) {
				continue
			}
		}
		read := readHead
		if c.Worktree {
			read = readWorktree
		}
		annotateComment(c, read)
	}
}

type fileDiffResult struct {
	files []git.FileDiff
	err   error
}

// markCurrent/markOutdated/markMoved set a comment's derived anchor fields. Every
// annotation path resolves to exactly one of these three states, so routing
// through them keeps AnchorStatus and the Current* lines assigned as a unit.
func markCurrent(c *store.Comment)  { c.AnchorStatus, c.CurrentStartLine, c.CurrentEndLine = store.AnchorCurrent, 0, 0 }
func markOutdated(c *store.Comment) { c.AnchorStatus, c.CurrentStartLine, c.CurrentEndLine = store.AnchorOutdated, 0, 0 }

func markMoved(c *store.Comment, start, end int) {
	c.AnchorStatus, c.CurrentStartLine, c.CurrentEndLine = store.AnchorMoved, start, end
}

// annotateByDiff sets a comment's anchor status by mapping its original range
// through the diff from its commit_sha to head. Returns false to fall back to
// snippet matching (unresolvable commit, binary/renamed file, etc.).
func annotateByDiff(repo *git.Repo, c *store.Comment, headRef string, cache map[string]*fileDiffResult) bool {
	key := c.CommitSHA + "\x00" + c.FilePath
	res := cache[key]
	if res == nil {
		files, err := repo.DiffFile(c.CommitSHA, headRef, c.FilePath)
		res = &fileDiffResult{files: files, err: err}
		cache[key] = res
	}
	if res.err != nil {
		return false
	}
	var fd *git.FileDiff
	for i := range res.files {
		if res.files[i].OldPath == c.FilePath || res.files[i].NewPath == c.FilePath {
			fd = &res.files[i]
			break
		}
	}
	if fd == nil {
		// File unchanged between commit_sha and head → still where it was.
		markCurrent(c)
		return true
	}
	if fd.Status == "deleted" {
		markOutdated(c)
		return true
	}
	if fd.Binary || len(fd.Hunks) == 0 {
		return false // no textual hunks to map — let the snippet path decide
	}
	// Every line in the range must survive and stay contiguous, else the block
	// was edited (outdated) rather than merely shifted (moved).
	ns, alive := git.MapOldLine(fd.Hunks, c.StartLine)
	if !alive {
		markOutdated(c)
		return true
	}
	prev := ns
	for l := c.StartLine + 1; l <= c.EndLine; l++ {
		nl, ok := git.MapOldLine(fd.Hunks, l)
		if !ok || nl != prev+1 {
			markOutdated(c)
			return true
		}
		prev = nl
	}
	if ns == c.StartLine {
		markCurrent(c)
	} else {
		markMoved(c, ns, prev)
	}
	return true
}

// fileReader returns a cached line-reader. Readable files yield a non-nil slice
// (min [""]); nil is cached for an unreadable path so it isn't re-fetched.
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

// annotateComment sets the anchor status from the current file lines. A comment
// with no captured snippet stays "current" — nothing to verify drift against.
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
		return // still anchored where it was captured
	}
	// Relocate only on an unambiguous hit; multiple matches read as outdated
	// rather than guessing.
	starts := findMatches(lines, snip)
	if len(starts) == 1 {
		markMoved(c, starts[0]+1, starts[0]+len(snip))
		return
	}
	markOutdated(c)
}

// matchAt reports whether snip appears in lines starting at 0-based index start.
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

// findMatches returns every 0-based start index where snip occurs in lines.
func findMatches(lines, snip []string) []int {
	var out []int
	for i := 0; i+len(snip) <= len(lines); i++ {
		if matchAt(lines, i, snip) {
			out = append(out, i)
		}
	}
	return out
}

// splitLines splits content into lines, dropping one trailing newline so it lines
// up with the diff's numbering (mirrors the frontend).
func splitLines(content string) []string {
	return strings.Split(strings.TrimSuffix(content, "\n"), "\n")
}

// captureSnippet reads the anchored range's text at add time from the same side
// the staleness check will later read — the working tree for an uncommitted
// anchor, else headRef — so the stored snippet matches what annotateComment
// compares it against. start/end are 1-based inclusive. Best-effort: a nil repo,
// unreadable file, or start past EOF yields "" (an empty snippet always reads as
// current), and end is clamped to the file's length.
func captureSnippet(repo *git.Repo, headRef, path string, start, end int, worktree bool) string {
	if repo == nil || start <= 0 {
		return ""
	}
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
