// Package git wraps the real git binary for the read-only operations the
// review tool needs: listing branches, computing the branch diff, and reading
// file content at a ref.
package git

import (
	"bufio"
	"bytes"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// Repo is a handle to a git working tree at an absolute path.
type Repo struct {
	Path string
}

func New(path string) *Repo { return &Repo{Path: path} }

// run executes git in the repo and returns stdout, or an error containing stderr.
func (r *Repo) run(args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-C", r.Path}, args...)...)
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, errb.String())
	}
	return out.String(), nil
}

// Branch describes a local branch.
type Branch struct {
	Name      string `json:"name"`
	IsCurrent bool   `json:"isCurrent"`
	IsMain    bool   `json:"isMain"`
}

// ListBranches returns local branches, flagging the current branch and the
// detected main branch (preferring "main", falling back to "master").
func (r *Repo) ListBranches() ([]Branch, error) {
	out, err := r.run("branch", "--format=%(refname:short)%(if)%(HEAD)%(then)\t*%(end)")
	if err != nil {
		return nil, err
	}
	main := r.MainBranch()
	var branches []Branch
	sc := bufio.NewScanner(strings.NewReader(out))
	for sc.Scan() {
		line := sc.Text()
		if line == "" {
			continue
		}
		name := line
		current := false
		if strings.Contains(line, "\t*") {
			name = strings.TrimSuffix(line, "\t*")
			current = true
		}
		branches = append(branches, Branch{Name: name, IsCurrent: current, IsMain: name == main})
	}
	return branches, sc.Err()
}

// MainBranch returns "main" if it exists, else "master" if it exists, else "main".
func (r *Repo) MainBranch() string {
	for _, name := range []string{"main", "master"} {
		if _, err := r.run("rev-parse", "--verify", "--quiet", name); err == nil {
			return name
		}
	}
	return "main"
}

// MergeBase returns the common ancestor of a and b.
func (r *Repo) MergeBase(a, b string) (string, error) {
	out, err := r.run("merge-base", a, b)
	return strings.TrimSpace(out), err
}

// ResolveSHA returns the full commit SHA a ref points to.
func (r *Repo) ResolveSHA(ref string) (string, error) {
	out, err := r.run("rev-parse", ref)
	return strings.TrimSpace(out), err
}

// FileContent returns the full content of a file at a ref.
func (r *Repo) FileContent(ref, path string) (string, error) {
	return r.run("show", ref+":"+path)
}

// --- Diff parsing ---

type DiffLine struct {
	Kind    string `json:"kind"` // "context" | "add" | "del"
	OldLine int    `json:"oldLine,omitempty"`
	NewLine int    `json:"newLine,omitempty"`
	Content string `json:"content"`
}

type Hunk struct {
	Header string     `json:"header"`
	Lines  []DiffLine `json:"lines"`
}

type FileDiff struct {
	OldPath string `json:"oldPath"`
	NewPath string `json:"newPath"`
	Status  string `json:"status"` // added | modified | deleted | renamed
	Hunks   []Hunk `json:"hunks"`
}

// Diff returns the parsed diff introduced between base and head.
func (r *Repo) Diff(base, head string) ([]FileDiff, error) {
	out, err := r.run("diff", "--no-color", "--find-renames", base, head)
	if err != nil {
		return nil, err
	}
	return parseDiff(out), nil
}

func parseDiff(text string) []FileDiff {
	var files []FileDiff
	var cur *FileDiff
	var hunk *Hunk
	var oldLn, newLn int

	flush := func() {
		if cur != nil {
			if hunk != nil {
				cur.Hunks = append(cur.Hunks, *hunk)
				hunk = nil
			}
			files = append(files, *cur)
		}
	}

	sc := bufio.NewScanner(strings.NewReader(text))
	sc.Buffer(make([]byte, 1024*1024), 16*1024*1024)
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "diff --git "):
			flush()
			cur = &FileDiff{Status: "modified"}
			hunk = nil
		case cur == nil:
			// preamble before first file; ignore
		case strings.HasPrefix(line, "new file"):
			cur.Status = "added"
		case strings.HasPrefix(line, "deleted file"):
			cur.Status = "deleted"
		case strings.HasPrefix(line, "rename from "):
			cur.OldPath = strings.TrimPrefix(line, "rename from ")
			cur.Status = "renamed"
		case strings.HasPrefix(line, "rename to "):
			cur.NewPath = strings.TrimPrefix(line, "rename to ")
			cur.Status = "renamed"
		case strings.HasPrefix(line, "--- "):
			cur.OldPath = stripDiffPath(strings.TrimPrefix(line, "--- "))
		case strings.HasPrefix(line, "+++ "):
			cur.NewPath = stripDiffPath(strings.TrimPrefix(line, "+++ "))
		case strings.HasPrefix(line, "@@"):
			if hunk != nil {
				cur.Hunks = append(cur.Hunks, *hunk)
			}
			oldLn, newLn = parseHunkHeader(line)
			hunk = &Hunk{Header: line}
		case hunk != nil:
			if len(line) == 0 {
				hunk.Lines = append(hunk.Lines, DiffLine{Kind: "context", OldLine: oldLn, NewLine: newLn, Content: ""})
				oldLn++
				newLn++
				continue
			}
			switch line[0] {
			case '+':
				hunk.Lines = append(hunk.Lines, DiffLine{Kind: "add", NewLine: newLn, Content: line[1:]})
				newLn++
			case '-':
				hunk.Lines = append(hunk.Lines, DiffLine{Kind: "del", OldLine: oldLn, Content: line[1:]})
				oldLn++
			case '\\':
				// "\ No newline at end of file" — ignore
			default:
				hunk.Lines = append(hunk.Lines, DiffLine{Kind: "context", OldLine: oldLn, NewLine: newLn, Content: line[1:]})
				oldLn++
				newLn++
			}
		}
	}
	flush()
	return files
}

func stripDiffPath(p string) string {
	p = strings.TrimSpace(p)
	if p == "/dev/null" {
		return ""
	}
	if strings.HasPrefix(p, "a/") || strings.HasPrefix(p, "b/") {
		return p[2:]
	}
	return p
}

// parseHunkHeader parses "@@ -oldStart,oldLines +newStart,newLines @@ ..." and
// returns the starting old and new line numbers.
func parseHunkHeader(h string) (oldStart, newStart int) {
	// h looks like: @@ -12,7 +12,9 @@ optional context
	parts := strings.Split(h, " ")
	for _, p := range parts {
		if strings.HasPrefix(p, "-") {
			oldStart = firstInt(p[1:])
		} else if strings.HasPrefix(p, "+") {
			newStart = firstInt(p[1:])
		}
	}
	return
}

func firstInt(s string) int {
	if i := strings.IndexByte(s, ','); i >= 0 {
		s = s[:i]
	}
	n, _ := strconv.Atoi(s)
	return n
}
