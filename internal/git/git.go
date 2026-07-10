// Package git wraps the real git binary for the read-only operations the
// review tool needs: listing branches, computing the branch diff, and reading
// file content at a ref.
package git

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
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
	sortBranches(branches)
	return branches, sc.Err()
}

// pinnedBranches are long-lived trunk/development/environment branches that
// make useful review bases; they sort to the top (in this order) ahead of the
// alphabetically-ordered feature branches.
var pinnedBranches = []string{"main", "master", "develop", "dev", "staging"}

// sortBranches floats the pinned base branches to the top in pinnedBranches
// order, leaving the rest sorted alphabetically.
func sortBranches(branches []Branch) {
	rank := func(name string) int {
		for i, p := range pinnedBranches {
			if name == p {
				return i
			}
		}
		return len(pinnedBranches)
	}
	sort.SliceStable(branches, func(i, j int) bool {
		ri, rj := rank(branches[i].Name), rank(branches[j].Name)
		if ri != rj {
			return ri < rj
		}
		return branches[i].Name < branches[j].Name
	})
}

// MainBranch returns the trunk to diff against: local "main" or "master" if
// present, else the remote default (origin/HEAD) or remote "origin/main"/
// "origin/master", else "" when nothing resolves.
func (r *Repo) MainBranch() string {
	for _, name := range []string{"main", "master"} {
		if _, err := r.run("rev-parse", "--verify", "--quiet", name); err == nil {
			return name
		}
	}
	// No local trunk — fall back to the remote's default branch, then to a
	// remote main/master. This covers working off origin/main without a local
	// main (e.g. a branch started from a detached `git checkout origin/main`).
	if out, err := r.run("rev-parse", "--abbrev-ref", "origin/HEAD"); err == nil {
		if name := strings.TrimSpace(out); name != "" && name != "origin/HEAD" {
			return name
		}
	}
	for _, name := range []string{"origin/main", "origin/master"} {
		if _, err := r.run("rev-parse", "--verify", "--quiet", name); err == nil {
			return name
		}
	}
	// Nothing resolvable; return "" rather than a fabricated "main" that would
	// fail merge-base. Callers require an explicit base in that case.
	return ""
}

// MergeBase returns the common ancestor of a and b.
func (r *Repo) MergeBase(a, b string) (string, error) {
	out, err := r.run("merge-base", a, b)
	return strings.TrimSpace(out), err
}

// ResolveSHA returns the full commit SHA a ref points to. --verify + ^{commit}
// resolves exactly one commit and fails cleanly when the ref is gone, instead
// of git's confusing "ambiguous argument … unknown revision or path" message a
// bare rev-parse emits for a non-existent ref.
func (r *Repo) ResolveSHA(ref string) (string, error) {
	out, err := r.run("rev-parse", "--verify", ref+"^{commit}")
	return strings.TrimSpace(out), err
}

// FileContent returns the full content of a file at a ref.
func (r *Repo) FileContent(ref, path string) (string, error) {
	return r.run("show", ref+":"+path)
}

// WorktreeFile returns the on-disk content of a file — the new side of an
// uncommitted (working-tree) diff, which git show can't read. The path is
// confined to the repo: no ".." escape and no reaching into .git.
func (r *Repo) WorktreeFile(path string) (string, error) {
	clean := filepath.Clean(path)
	if clean == ".git" || strings.HasPrefix(clean, ".git"+string(filepath.Separator)) {
		return "", fmt.Errorf("invalid path %q", path)
	}
	full := filepath.Join(r.Path, clean)
	rel, err := filepath.Rel(r.Path, full)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("invalid path %q", path)
	}
	b, err := os.ReadFile(full)
	return string(b), err
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
	Binary  bool   `json:"binary,omitempty"`
	Hunks   []Hunk `json:"hunks"`
}

// diffPrefixArgs forces canonical a/ and b/ path prefixes so parseDiff can
// strip them, regardless of the user's git config (diff.mnemonicPrefix uses
// c//w//i//o/ on worktree diffs, diff.noprefix drops prefixes, and
// diff.srcprefix/dstprefix set custom ones).
var diffPrefixArgs = []string{"--src-prefix=a/", "--dst-prefix=b/"}

// Diff returns the parsed diff introduced between base and head.
func (r *Repo) Diff(base, head string) ([]FileDiff, error) {
	args := append([]string{"diff", "--no-color", "--find-renames"}, diffPrefixArgs...)
	out, err := r.run(append(args, base, head)...)
	if err != nil {
		return nil, err
	}
	return parseDiff(out), nil
}

// DiffFile returns the diff of a single path between two refs.
func (r *Repo) DiffFile(from, to, path string) ([]FileDiff, error) {
	args := append([]string{"diff", "--no-color", "--find-renames"}, diffPrefixArgs...)
	args = append(args, from, to, "--", path)
	out, err := r.run(args...)
	if err != nil {
		return nil, err
	}
	return parseDiff(out), nil
}

// MapOldLine maps an old-side line (1-based) to its new-side line using a file's
// diff hunks, carrying the running offset across the unchanged regions between
// hunks. alive=false means the old line was deleted or modified (no new-side
// counterpart).
func MapOldLine(hunks []Hunk, old int) (newLine int, alive bool) {
	offset := 0
	for _, h := range hunks {
		oldStart, newStart := parseHunkHeader(h.Header)
		if old < oldStart {
			return old + offset, true // unchanged region before this hunk
		}
		oldLn, newLn := oldStart, newStart
		for _, l := range h.Lines {
			switch l.Kind {
			case "context":
				if oldLn == old {
					return newLn, true
				}
				oldLn++
				newLn++
			case "del":
				if oldLn == old {
					return 0, false
				}
				oldLn++
			case "add":
				newLn++
			}
		}
		offset = newLn - oldLn
	}
	return old + offset, true // unchanged region after the last hunk
}

// DiffWorktree returns the diff from base to the current working tree: the
// committed changes on the checked-out branch plus staged and unstaged edits
// to tracked files, and untracked (non-ignored) files as new files. Only
// meaningful when base's other side is the checked-out branch, since the working
// tree reflects whatever HEAD is checked out.
func (r *Repo) DiffWorktree(base string) ([]FileDiff, error) {
	args := append([]string{"diff", "--no-color", "--find-renames"}, diffPrefixArgs...)
	out, err := r.run(append(args, base)...)
	if err != nil {
		return nil, err
	}
	files := parseDiff(out)
	// git diff omits untracked files, so add them explicitly — otherwise the
	// uncommitted view only shows tracked (staged/unstaged) changes and a brand
	// new file doesn't appear until it's `git add`ed.
	untracked, err := r.untrackedFiles()
	if err != nil {
		return nil, err
	}
	for _, p := range untracked {
		if fd, ok := r.newFileDiff(p); ok {
			files = append(files, fd)
		}
	}
	return files, nil
}

// untrackedFiles lists untracked, non-ignored files (NUL-separated so paths with
// odd characters survive).
func (r *Repo) untrackedFiles() ([]string, error) {
	out, err := r.run("ls-files", "--others", "--exclude-standard", "-z")
	if err != nil {
		return nil, err
	}
	var paths []string
	for _, p := range strings.Split(out, "\x00") {
		if p != "" {
			paths = append(paths, p)
		}
	}
	return paths, nil
}

// newFileDiff synthesizes an added FileDiff for an untracked file from its
// on-disk content. Binary and empty files get no hunks (mirroring git's diffs).
func (r *Repo) newFileDiff(path string) (FileDiff, bool) {
	content, err := r.WorktreeFile(path)
	if err != nil {
		return FileDiff{}, false // vanished or unreadable since ls-files listed it
	}
	fd := FileDiff{Status: "added", NewPath: path, Hunks: []Hunk{}}
	if strings.IndexByte(content, 0) >= 0 {
		fd.Binary = true
		return fd, true
	}
	if content == "" {
		return fd, true
	}
	lines := strings.Split(strings.TrimSuffix(content, "\n"), "\n")
	hunk := Hunk{Header: fmt.Sprintf("@@ -0,0 +1,%d @@", len(lines))}
	for i, l := range lines {
		hunk.Lines = append(hunk.Lines, DiffLine{Kind: "add", NewLine: i + 1, Content: l})
	}
	fd.Hunks = []Hunk{hunk}
	return fd, true
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
			if cur.Hunks == nil {
				// Binary files, pure renames, and mode-only changes carry no
				// hunks. Emit an empty slice (JSON []) rather than a nil slice
				// (JSON null) so the frontend's hunks[] contract holds.
				cur.Hunks = []Hunk{}
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
			// Seed paths from the header so binary and mode-only changes (which
			// emit no ---/+++ or rename lines) still get a name. The
			// authoritative ---/+++/rename lines below override when present.
			cur.OldPath, cur.NewPath = parseGitHeaderPaths(line)
		case cur == nil:
			// preamble before first file; ignore
		case strings.HasPrefix(line, "@@"):
			if hunk != nil {
				cur.Hunks = append(cur.Hunks, *hunk)
			}
			oldLn, newLn = parseHunkHeader(line)
			hunk = &Hunk{Header: line}
		case hunk != nil:
			// Inside a hunk, every line is content. This must precede the ---/+++
			// (and new file / rename) header cases: a deleted line whose content
			// starts with "-- " (e.g. a SQL comment) becomes "--- …" in the diff,
			// and an added "++ …" line becomes "+++ …" — matching those headers
			// would drop the line and corrupt the line numbering.
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
		case strings.HasPrefix(line, "new file"):
			cur.Status = "added"
			cur.OldPath = "" // added: nothing on the old side (the header seeded both)
		case strings.HasPrefix(line, "deleted file"):
			cur.Status = "deleted"
			cur.NewPath = "" // deleted: nothing on the new side
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
		case strings.HasPrefix(line, "Binary files "):
			cur.Binary = true
		}
	}
	flush()
	return files
}

// parseGitHeaderPaths extracts the old and new paths from a
// "diff --git a/<old> b/<new>" header. We force a/ and b/ prefixes (see
// diffPrefixArgs), so splitting on the " b/" separator is reliable except for
// the rare path containing " b/" — which, being a text/rename case, is
// corrected by the authoritative ---/+++/rename lines anyway.
func parseGitHeaderPaths(line string) (oldPath, newPath string) {
	rest := strings.TrimPrefix(line, "diff --git ")
	i := strings.Index(rest, " b/")
	if i < 0 {
		return "", ""
	}
	return strings.TrimPrefix(rest[:i], "a/"), rest[i+len(" b/"):]
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
	// h looks like: @@ -12,7 +12,9 @@ optional section heading
	// Only the two fixed-position range tokens are the line numbers; the
	// trailing section heading git appends can itself contain "-"/"+" tokens
	// (e.g. a "->" return arrow or "x += 1"), so we must not scan the whole line.
	parts := strings.Split(h, " ")
	if len(parts) < 3 {
		return
	}
	oldStart = firstInt(strings.TrimPrefix(parts[1], "-"))
	newStart = firstInt(strings.TrimPrefix(parts[2], "+"))
	return
}

func firstInt(s string) int {
	if i := strings.IndexByte(s, ','); i >= 0 {
		s = s[:i]
	}
	n, _ := strconv.Atoi(s)
	return n
}
