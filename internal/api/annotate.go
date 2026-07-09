package api

import (
	"strings"

	"local-review/internal/git"
	"local-review/internal/store"
)

// Anchor statuses reported to the client (Comment.AnchorStatus).
const (
	anchorCurrent  = "current"  // snippet still sits at the stored line range
	anchorMoved    = "moved"    // snippet relocated to a unique new range (Current* lines)
	anchorOutdated = "outdated" // snippet gone, ambiguous, or file unreadable
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
// headRef at most once.
func annotateComments(repo *git.Repo, headRef string, comments []store.Comment) {
	cache := map[string][]string{}
	// read returns the file's lines at headRef and whether it was readable. A
	// readable file always yields a non-nil slice (min [""]); nil is cached to
	// mark an unreadable path (deleted/renamed) so it isn't re-fetched.
	read := func(path string) ([]string, bool) {
		if lines, ok := cache[path]; ok {
			return lines, lines != nil
		}
		content, err := repo.FileContent(headRef, path)
		if err != nil {
			cache[path] = nil
			return nil, false
		}
		lines := splitLines(content)
		cache[path] = lines
		return lines, true
	}
	for i := range comments {
		annotateComment(&comments[i], read)
	}
}

// annotateComment sets c.AnchorStatus (and Current* lines when moved) from the
// current file lines. A comment with no captured snippet stays "current" — there
// is nothing to verify drift against.
func annotateComment(c *store.Comment, read func(string) ([]string, bool)) {
	c.AnchorStatus, c.CurrentStartLine, c.CurrentEndLine = anchorCurrent, 0, 0

	snippet := strings.TrimRight(c.Snippet, "\n")
	if strings.TrimSpace(snippet) == "" {
		return
	}
	lines, ok := read(c.FilePath)
	if !ok {
		c.AnchorStatus = anchorOutdated
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
		c.AnchorStatus = anchorMoved
		c.CurrentStartLine = starts[0] + 1
		c.CurrentEndLine = starts[0] + len(snip)
		return
	}
	c.AnchorStatus = anchorOutdated
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
