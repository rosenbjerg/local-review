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
	diffCache := map[string]*fileDiffResult{}
	for i := range comments {
		c := &comments[i]
		// Prefer diff-based tracking (commit_sha → head): snippet matching can't
		// tell a genuine move from a coincidental reappearance of the same lines.
		// Only for head-anchored comments — working-tree/index sides snippet-match.
		if !c.Worktree && !c.Indexed && c.StartLine > 0 && c.CommitSHA != "" && c.CommitSHA != headSHA {
			if annotateByDiff(repo, c, headRef, diffCache) {
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

// Returns false to fall back to snippet matching (unresolvable commit, binary file,
// modification with no textual hunks). The diff is queried whole (no pathspec) so
// git can pair a rename — restricting to the old path would report a bare deletion.
func annotateByDiff(repo *git.Repo, c *store.Comment, headRef string, cache map[string]*fileDiffResult) bool {
	res := cache[c.CommitSHA]
	if res == nil {
		files, err := repo.Diff(c.CommitSHA, headRef)
		res = &fileDiffResult{files: files, err: err}
		cache[c.CommitSHA] = res
	}
	if res.err != nil {
		return false
	}
	// The comment is keyed to its original (old-side) path.
	var fd *git.FileDiff
	for i := range res.files {
		if res.files[i].OldPath == c.FilePath || res.files[i].NewPath == c.FilePath {
			fd = &res.files[i]
			break
		}
	}
	if fd == nil {
		// File untouched between commit_sha and head → still where it was.
		markCurrent(c)
		return true
	}
	if fd.Status == git.FileDeleted {
		markOutdated(c)
		return true
	}
	if fd.Binary {
		return false // no textual side to map — let the snippet path decide
	}
	// A rename may carry no hunks (a pure move, R100): the lines map 1:1, only the
	// path changes. A modification with no hunks (mode-only, etc.) has nothing to
	// map, so defer to snippet matching.
	renamed := fd.Status == git.FileRenamed
	if len(fd.Hunks) == 0 && !renamed {
		return false
	}
	newPath := ""
	if renamed {
		newPath = fd.NewPath
	}
	// Every line in the range must survive and stay contiguous, else the block was
	// edited (outdated) rather than merely shifted/moved.
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
