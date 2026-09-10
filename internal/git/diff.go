package git

import (
	"bufio"
	"fmt"
	"strconv"
	"strings"
)

type LineKind string

const (
	LineContext LineKind = "context"
	LineAdd     LineKind = "add"
	LineDel     LineKind = "del"
)

type DiffLine struct {
	Kind    LineKind `json:"kind"`
	OldLine int      `json:"oldLine,omitempty"`
	NewLine int      `json:"newLine,omitempty"`
	Content string   `json:"content"`
}

type Hunk struct {
	Header string     `json:"header"`
	Lines  []DiffLine `json:"lines"`
}

type FileStatus string

const (
	FileAdded    FileStatus = "added"
	FileModified FileStatus = "modified"
	FileDeleted  FileStatus = "deleted"
	FileRenamed  FileStatus = "renamed"
)

type FileDiff struct {
	OldPath string     `json:"oldPath"`
	NewPath string     `json:"newPath"`
	Status  FileStatus `json:"status"`
	Binary  bool       `json:"binary,omitempty"`
	Hunks   []Hunk     `json:"hunks"`
}

// diffArgs pins the output shape the parser relies on: verbatim non-ASCII paths and the
// a/ b/ prefixes, regardless of the user's diff.*prefix config.
func diffArgs(rest ...string) []string {
	// --no-ext-diff / --no-textconv: a configured external diff or textconv emits output the parser can't read.
	base := []string{"-c", "core.quotePath=false", "diff", "--no-color", "--no-ext-diff", "--no-textconv", "--find-renames", "--src-prefix=a/", "--dst-prefix=b/"}
	return append(base, rest...)
}

func (r *Repo) Diff(base, head string) ([]FileDiff, error) {
	out, err := r.run(diffArgs(base, head)...)
	if err != nil {
		return nil, err
	}
	return parseDiff(out)
}

// DiffFile is Diff restricted to one path; the pathspec defeats rename pairing, so a rename shows as a bare deletion.
func (r *Repo) DiffFile(from, to, path string) ([]FileDiff, error) {
	out, err := r.run(diffArgs(from, to, "--", path)...)
	if err != nil {
		return nil, err
	}
	return parseDiff(out)
}

// DiffWorktree diffs base against the working tree, untracked files included as added.
func (r *Repo) DiffWorktree(base string) ([]FileDiff, error) {
	out, err := r.run(diffArgs(base)...)
	if err != nil {
		return nil, err
	}
	files, err := parseDiff(out)
	if err != nil {
		return nil, err
	}
	return r.appendUntracked(files)
}

// DiffStaged diffs from against the index (`git diff --cached`); untracked files are never staged, so none appear.
func (r *Repo) DiffStaged(from string) ([]FileDiff, error) {
	out, err := r.run(diffArgs("--cached", from)...)
	if err != nil {
		return nil, err
	}
	return parseDiff(out)
}

// git diff omits untracked files, so a new file wouldn't appear until `git add`ed.
func (r *Repo) appendUntracked(files []FileDiff) ([]FileDiff, error) {
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

func (r *Repo) newFileDiff(path string) (FileDiff, bool) {
	content, err := r.WorktreeFile(path)
	if err != nil {
		return FileDiff{}, false // vanished or unreadable since ls-files listed it
	}
	fd := FileDiff{Status: FileAdded, NewPath: path, Hunks: []Hunk{}}
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
		hunk.Lines = append(hunk.Lines, DiffLine{Kind: LineAdd, NewLine: i + 1, Content: l})
	}
	fd.Hunks = []Hunk{hunk}
	return fd, true
}

func parseDiff(text string) ([]FileDiff, error) {
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
				// [] not nil: the frontend's hunks[] contract
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
			cur = &FileDiff{Status: FileModified}
			hunk = nil
			// Seed paths from the header: a binary or mode-only change has no ---/+++ lines to name it.
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
			// Must precede the ---/+++ cases: a deleted "-- …" line reads as a "--- " header.
			if len(line) == 0 {
				hunk.Lines = append(hunk.Lines, DiffLine{Kind: LineContext, OldLine: oldLn, NewLine: newLn, Content: ""})
				oldLn++
				newLn++
				continue
			}
			switch line[0] {
			case '+':
				hunk.Lines = append(hunk.Lines, DiffLine{Kind: LineAdd, NewLine: newLn, Content: line[1:]})
				newLn++
			case '-':
				hunk.Lines = append(hunk.Lines, DiffLine{Kind: LineDel, OldLine: oldLn, Content: line[1:]})
				oldLn++
			case '\\':
				// "\ No newline at end of file" — ignore
			default:
				hunk.Lines = append(hunk.Lines, DiffLine{Kind: LineContext, OldLine: oldLn, NewLine: newLn, Content: line[1:]})
				oldLn++
				newLn++
			}
		case strings.HasPrefix(line, "new file"):
			cur.Status = FileAdded
			cur.OldPath = "" // added: nothing on the old side (the header seeded both)
		case strings.HasPrefix(line, "deleted file"):
			cur.Status = FileDeleted
			cur.NewPath = "" // deleted: nothing on the new side
		case strings.HasPrefix(line, "rename from "):
			cur.OldPath = strings.TrimPrefix(line, "rename from ")
			cur.Status = FileRenamed
		case strings.HasPrefix(line, "rename to "):
			cur.NewPath = strings.TrimPrefix(line, "rename to ")
			cur.Status = FileRenamed
		case strings.HasPrefix(line, "--- "):
			cur.OldPath = stripDiffPath(strings.TrimPrefix(line, "--- "))
		case strings.HasPrefix(line, "+++ "):
			cur.NewPath = stripDiffPath(strings.TrimPrefix(line, "+++ "))
		case strings.HasPrefix(line, "Binary files "):
			cur.Binary = true
		}
	}
	if err := sc.Err(); err != nil {
		// A line over the buffer trips ErrTooLong; surface it rather than drop every file after it.
		return nil, fmt.Errorf("parse diff: %w", err)
	}
	flush()
	return files, nil
}

// Splitting on " b/" holds because diffArgs forces the prefixes; the ---/+++ lines correct any path containing it.
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

func parseHunkHeader(h string) (oldStart, newStart int) {
	// "@@ -12,7 +12,9 @@ heading": only the two fixed-position tokens are ranges; the heading can hold "-"/"+".
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
