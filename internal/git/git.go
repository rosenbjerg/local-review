// Package git wraps the git binary for the tool's read-only operations: listing
// branches, computing the branch diff, and reading file content at a ref.
package git

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type Repo struct {
	Path string
}

func New(path string) *Repo { return &Repo{Path: path} }

func (r *Repo) run(args ...string) (string, error) {
	return r.runEnv(nil, args...)
}

// Pass to runEnv for read-only commands the poller runs on a timer. Without it,
// git may refresh — and write — the index as a side effect, taking index.lock;
// that can make a concurrent write by the user's own git (an agent committing)
// fail with "unable to lock index". Output stays correct; only the stat-cache
// write is skipped. Don't remove it from the polling path.
var optionalLocksOff = []string{"GIT_OPTIONAL_LOCKS=0"}

// runEnv is run with extra KEY=VALUE entries appended to the process environment.
func (r *Repo) runEnv(env []string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-C", r.Path}, args...)...)
	if len(env) > 0 {
		cmd.Env = append(os.Environ(), env...)
	}
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, errb.String())
	}
	return out.String(), nil
}

type Branch struct {
	Name      string `json:"name"`
	IsCurrent bool   `json:"isCurrent"`
	IsMain    bool   `json:"isMain"`
	IsRemote  bool   `json:"isRemote"`
}

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
	if err := sc.Err(); err != nil {
		return nil, err
	}
	// Remote-tracking branches feed the base picker, so a branch worked off
	// origin/main with no local trunk can still be diffed against origin/main.
	remotes, err := r.remoteBranches(main)
	if err != nil {
		return nil, err
	}
	branches = append(branches, remotes...)
	sortBranches(branches)
	return branches, nil
}

// remoteBranches lists remote-tracking branches (e.g. "origin/main"). It skips
// the symbolic origin/HEAD pointer via %(symref) rather than fragile "->"
// parsing, and reflects only what the last fetch pulled — it does not fetch.
func (r *Repo) remoteBranches(main string) ([]Branch, error) {
	out, err := r.run("for-each-ref", "--format=%(refname:short) %(symref)", "refs/remotes")
	if err != nil {
		return nil, err
	}
	var branches []Branch
	sc := bufio.NewScanner(strings.NewReader(out))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		// A non-empty symref marks the "origin/HEAD -> origin/main" pointer, not a
		// real branch. After trimming, a normal ref leaves just its short name.
		name, symref, _ := strings.Cut(line, " ")
		if strings.TrimSpace(symref) != "" {
			continue
		}
		branches = append(branches, Branch{Name: name, IsMain: name == main, IsRemote: true})
	}
	return branches, sc.Err()
}

var pinnedBranches = []string{"main", "master", "develop", "dev", "staging"}

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
		// Locals before remotes, then pinned trunks, then alphabetical.
		if branches[i].IsRemote != branches[j].IsRemote {
			return !branches[i].IsRemote
		}
		ri, rj := rank(branches[i].Name), rank(branches[j].Name)
		if ri != rj {
			return ri < rj
		}
		return branches[i].Name < branches[j].Name
	})
}

func (r *Repo) MainBranch() string {
	for _, name := range []string{"main", "master"} {
		if _, err := r.run("rev-parse", "--verify", "--quiet", name); err == nil {
			return name
		}
	}
	// No local trunk: fall back to the remote default, then origin/main|master —
	// covers a branch worked off origin/main with no local main.
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
	// Return "" rather than a fabricated "main" that would fail merge-base;
	// callers then require an explicit base.
	return ""
}

func (r *Repo) MergeBase(a, b string) (string, error) {
	out, err := r.run("merge-base", a, b)
	return strings.TrimSpace(out), err
}

// --verify + ^{commit} fails cleanly on a missing ref, instead of the confusing
// "ambiguous argument" a bare rev-parse emits.
func (r *Repo) ResolveSHA(ref string) (string, error) {
	out, err := r.run("rev-parse", "--verify", ref+"^{commit}")
	return strings.TrimSpace(out), err
}

func (r *Repo) FileContent(ref, path string) (string, error) {
	return r.run("show", ref+":"+path)
}

// IndexFile reads a path's staged content — the stage-0 index blob (`git show
// :path`) — which is the new side of the "staged" diff (index vs HEAD).
func (r *Repo) IndexFile(path string) (string, error) {
	return r.run("show", ":"+path)
}

// ListFiles returns the tracked file paths at ref, for the "comment on a
// non-changed file" picker. quotePath=false keeps non-ASCII paths verbatim, to
// match the diff parser (see diffArgs).
func (r *Repo) ListFiles(ref string) ([]string, error) {
	out, err := r.run("-c", "core.quotePath=false", "ls-tree", "-r", "--name-only", ref)
	if err != nil {
		return nil, err
	}
	var files []string
	sc := bufio.NewScanner(strings.NewReader(out))
	sc.Buffer(make([]byte, 1024*1024), 16*1024*1024)
	for sc.Scan() {
		if line := sc.Text(); line != "" {
			files = append(files, line)
		}
	}
	return files, sc.Err()
}

type Commit struct {
	SHA      string `json:"sha"`
	ShortSHA string `json:"shortSha"`
	Subject  string `json:"subject"`
	RelDate  string `json:"relDate"`
}

// RecentCommits lists up to limit commits that ref introduces over base
// (`git log base..ref`), newest first, for the diff "from" picker — so it offers
// only the branch's own commits, not base-branch history behind the merge point.
// An empty base falls back to ref's full ancestry (`git log ref`). Fields are
// unit-separated (0x1f) so a subject can't split them; records are newline-separated
// (subjects are one line).
func (r *Repo) RecentCommits(base, ref string, limit int) ([]Commit, error) {
	rangeArg := ref
	if base != "" {
		rangeArg = base + ".." + ref
	}
	out, err := r.run("log", rangeArg, "-n", strconv.Itoa(limit), "--format=%H%x1f%h%x1f%s%x1f%cr")
	if err != nil {
		return nil, err
	}
	var commits []Commit
	sc := bufio.NewScanner(strings.NewReader(out))
	sc.Buffer(make([]byte, 1024*1024), 16*1024*1024)
	for sc.Scan() {
		line := sc.Text()
		if line == "" {
			continue
		}
		f := strings.Split(line, "\x1f")
		if len(f) != 4 {
			continue
		}
		commits = append(commits, Commit{SHA: f[0], ShortSHA: f[1], Subject: f[2], RelDate: f[3]})
	}
	return commits, sc.Err()
}

// Reads the working-tree (on-disk) side, which git show can't. The path is
// confined to the repo below — no ".." escape, no reaching into .git.
func (r *Repo) WorktreeFile(path string) (string, error) {
	sep := string(filepath.Separator)
	clean := filepath.Clean(path)
	// On a case-insensitive FS (macOS/Windows) ".GIT/config" hits the real .git,
	// so reject every case variant.
	if lower := strings.ToLower(clean); lower == ".git" || strings.HasPrefix(lower, ".git"+sep) {
		return "", fmt.Errorf("invalid path %q", path)
	}
	full := filepath.Join(r.Path, clean)
	// Resolve symlinks and confirm the target stays inside the repo, so an in-repo
	// symlink pointing outward can't be followed out of the tree.
	root, err := filepath.EvalSymlinks(r.Path)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(full)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(root, resolved)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+sep) {
		return "", fmt.Errorf("invalid path %q", path)
	}
	b, err := os.ReadFile(resolved)
	return string(b), err
}

// WorktreeFingerprint is a cheap, content-free signal of whether anything the
// review renders could have changed. It hashes three parts: the committed HEAD
// (catches commits/amends, which don't touch working-tree mtimes), the set of
// tracked and untracked changes (catches new/deleted/renamed files), and each of
// those paths' mtime (catches a re-edit that leaves a file's git status unchanged).
// It reads no file content, so its cost stays flat even when the diff includes
// large files. Any git error is returned so the caller can treat it as "no change"
// (e.g. a transient failure mid-rebase).
func (r *Repo) WorktreeFingerprint() (string, error) {
	head, err := r.runEnv(optionalLocksOff, "rev-parse", "HEAD")
	if err != nil {
		return "", err
	}
	tracked, err := r.runEnv(optionalLocksOff, "diff", "--name-only", "-z", "HEAD")
	if err != nil {
		return "", err
	}
	untracked, err := r.runEnv(optionalLocksOff, "ls-files", "--others", "--exclude-standard", "-z")
	if err != nil {
		return "", err
	}
	h := sha256.New()
	h.Write([]byte(head))
	h.Write([]byte(tracked))
	h.Write([]byte(untracked))
	for _, p := range append(splitNUL(tracked), splitNUL(untracked)...) {
		h.Write([]byte(p))
		// A deleted path (listed by --name-only) fails to stat; the "absent" marker
		// is a stable stand-in, and the deletion already shows in the set hash above.
		if fi, err := os.Stat(filepath.Join(r.Path, p)); err == nil {
			fmt.Fprintf(h, ":%d", fi.ModTime().UnixNano())
		} else {
			h.Write([]byte(":absent"))
		}
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func splitNUL(s string) []string {
	var out []string
	for _, p := range strings.Split(s, "\x00") {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// --- Diff parsing ---

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

// quotePath=false keeps non-ASCII paths verbatim (the default octal-escapes them,
// which the parsers can't unwrap); the forced a//b/ prefixes let parseDiff strip
// them regardless of the user's diff.*prefix config. The -c flags must precede diff.
func diffArgs(rest ...string) []string {
	base := []string{"-c", "core.quotePath=false", "diff", "--no-color", "--find-renames", "--src-prefix=a/", "--dst-prefix=b/"}
	return append(base, rest...)
}

func (r *Repo) Diff(base, head string) ([]FileDiff, error) {
	out, err := r.run(diffArgs(base, head)...)
	if err != nil {
		return nil, err
	}
	return parseDiff(out)
}

// DiffFile is Diff restricted to one path — cheap when only one file's status is
// needed. Restricting to the path prevents rename pairing (the new side is out of
// scope), so a renamed file shows here as a plain deletion; callers needing the
// rename target fall back to the whole-tree Diff.
func (r *Repo) DiffFile(from, to, path string) ([]FileDiff, error) {
	out, err := r.run(diffArgs(from, to, "--", path)...)
	if err != nil {
		return nil, err
	}
	return parseDiff(out)
}

// Maps a 1-based old-side line to its new-side line; alive=false means the line
// was deleted or modified (no new-side counterpart).
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
			case LineContext:
				if oldLn == old {
					return newLn, true
				}
				oldLn++
				newLn++
			case LineDel:
				if oldLn == old {
					return 0, false
				}
				oldLn++
			case LineAdd:
				newLn++
			}
		}
		offset = newLn - oldLn
	}
	return old + offset, true // unchanged region after the last hunk
}

// Only meaningful when the checked-out branch is base's other side; untracked
// non-ignored files are added as new (see below). base "HEAD" gives the whole
// uncommitted delta (staged + unstaged).
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

// DiffStaged is the index vs `from` (`git diff --cached <from>`) — the staged
// changes (plus any commits between from and HEAD, which the index reflects), with
// the index as the new side. from "HEAD" gives just the staged changes; a
// merge-base or older commit widens the before side. No untracked files (those are
// never staged).
func (r *Repo) DiffStaged(from string) ([]FileDiff, error) {
	out, err := r.run(diffArgs("--cached", from)...)
	if err != nil {
		return nil, err
	}
	return parseDiff(out)
}

// git diff omits untracked files, so add them explicitly — else a brand new file
// wouldn't appear until `git add`ed. (Untracked files are unstaged.)
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
				// No hunks (binary, pure rename, mode-only): emit [] not nil so the
				// frontend's hunks[] contract holds.
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
			// Seed paths from the header so binary/mode-only changes (no ---/+++ or
			// rename lines) still get a name; authoritative lines override below.
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
			// Inside a hunk every line is content. Must precede the ---/+++ cases:
			// a deleted "-- …" line becomes "--- …" and an added "++ …" becomes
			// "+++ …", which would else match those headers and corrupt numbering.
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
		// A line over the 16MB buffer (minified bundle, source map) trips
		// ErrTooLong. Surface it rather than silently drop every file after it.
		return nil, fmt.Errorf("parse diff: %w", err)
	}
	flush()
	return files, nil
}

// Splitting the "diff --git a/<old> b/<new>" header on " b/" is reliable because
// diffArgs forces a//b/ prefixes; a path containing " b/" is a text/rename case
// the authoritative ---/+++/rename lines correct anyway.
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
	// h looks like: @@ -12,7 +12,9 @@ optional section heading
	// Only the two fixed-position range tokens are line numbers; the trailing
	// section heading can contain "-"/"+" (e.g. "->" or "x += 1"), so don't scan
	// the whole line.
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
