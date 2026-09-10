// The fallback anchor check: match the stored snippet against the file's current text.
// It cannot tell a move from a coincidence, so it is used only where diff tracking can't
// run — worktree and index comments, comments with no commit sha, and binaries.
package review

import (
	"strings"

	"local-review/internal/git"
	"local-review/internal/store"
)

// annotateBySnippet matches on text alone; a comment with no snippet (a line-0 file comment) stays current.
func annotateBySnippet(c *store.Comment, read func(string) ([]string, bool)) {
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

// CaptureSnippet reads the range from the side annotateBySnippet will later compare against,
// which is why the server captures it rather than trusting the client's copy. Best-effort:
// "" when the file or start is out of reach.
func CaptureSnippet(repo *git.Repo, headRef, path string, start, end int, side store.Side) string {
	if repo == nil || start <= 0 {
		return ""
	}
	content, err := ReadSide(repo, headRef, path, side)
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
