package api

import (
	"strings"

	"local-review/internal/git"
	"local-review/internal/store"
)

// annotateReview fills in each comment's live anchor status by comparing its
// captured snippet against the current file content at the review's head. It is
// derived state (never persisted): the branch keeps moving, so it is recomputed
// on every read rather than baked into the stored line numbers.
func (s *Server) annotateReview(review *store.Review) {
	if len(review.Comments) == 0 {
		return
	}
	annotateComments(git.New(review.RepoPath), review.HeadRef, review.Comments)
}

// annotateComments annotates comments in place, reading each distinct file at
// most once per side. Comments made against the working tree (an uncommitted
// diff) are compared to the on-disk content; the rest to headRef — otherwise a
// working-tree snippet never matches the committed head and reads as outdated.
func annotateComments(repo *git.Repo, headRef string, comments []store.Comment) {
	readHead := fileReader(func(path string) (string, error) {
		return repo.FileContent(headRef, path)
	})
	readWorktree := fileReader(repo.WorktreeFile)
	for i := range comments {
		read := readHead
		if comments[i].Worktree {
			read = readWorktree
		}
		annotateComment(&comments[i], read)
	}
}

// fileReader returns a cached line-reader. A readable file always yields a
// non-nil slice (min [""]); nil is cached to mark an unreadable path
// (deleted/renamed) so it isn't re-fetched.
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

// annotateComment sets c.AnchorStatus (and Current* lines when moved) from the
// current file lines. A comment with no captured snippet stays "current" — there
// is nothing to verify drift against.
func annotateComment(c *store.Comment, read func(string) ([]string, bool)) {
	c.AnchorStatus, c.CurrentStartLine, c.CurrentEndLine = store.AnchorCurrent, 0, 0

	snippet := strings.TrimRight(c.Snippet, "\n")
	if strings.TrimSpace(snippet) == "" {
		return
	}
	lines, ok := read(c.FilePath)
	if !ok {
		c.AnchorStatus = store.AnchorOutdated
		return
	}
	snip := strings.Split(snippet, "\n")
	if matchAt(lines, c.StartLine-1, snip) {
		return // still anchored where it was captured
	}
	// Relocate only on an unambiguous hit; multiple matches can't be resolved
	// safely, so they read as outdated rather than guessing.
	starts := findMatches(lines, snip)
	if len(starts) == 1 {
		c.AnchorStatus = store.AnchorMoved
		c.CurrentStartLine = starts[0] + 1
		c.CurrentEndLine = starts[0] + len(snip)
		return
	}
	c.AnchorStatus = store.AnchorOutdated
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

// splitLines splits file content into lines, dropping a single trailing newline
// so it lines up with the diff's line numbering (mirrors the frontend).
func splitLines(content string) []string {
	return strings.Split(strings.TrimSuffix(content, "\n"), "\n")
}
