// Package git wraps the git binary for the tool's read-only operations.
package git

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Bounds every git invocation: a hung filter or credential prompt must not wedge a handler or the poller.
const gitTimeout = 30 * time.Second

type Repo struct {
	Path string
}

func New(path string) *Repo { return &Repo{Path: path} }

func (r *Repo) run(args ...string) (string, error) {
	return r.runEnv(nil, args...)
}

// optionalLocksOff keeps a timed read from refreshing the index and taking index.lock
// out from under a concurrent `git commit`.
var optionalLocksOff = []string{"GIT_OPTIONAL_LOCKS=0"}

// runEnv is run with extra KEY=VALUE entries appended to the process environment.
func (r *Repo) runEnv(env []string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), gitTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", r.Path}, args...)...)
	// GIT_TERMINAL_PROMPT=0: never block on a credential prompt.
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	cmd.Env = append(cmd.Env, env...)
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
	// LastCommit is the tip commit's committer date (RFC3339), which the picker orders by.
	LastCommit string `json:"lastCommit"`
}

func (r *Repo) ListBranches() ([]Branch, error) {
	// A literal \x1f, not git's %x1f escape: `git branch --format` prints that escape verbatim.
	out, err := r.run("branch", "--format=%(refname:short)\x1f%(committerdate:iso-strict)\x1f%(HEAD)")
	if err != nil {
		return nil, err
	}
	main := r.MainBranch()
	branches := []Branch{} // never nil: the endpoint promises [], and a null crashes the client
	sc := bufio.NewScanner(strings.NewReader(out))
	for sc.Scan() {
		line := sc.Text()
		if line == "" {
			continue
		}
		f := strings.Split(line, "\x1f")
		if len(f) != 3 {
			continue
		}
		name := f[0]
		branches = append(branches, Branch{
			Name:       name,
			IsCurrent:  strings.TrimSpace(f[2]) == "*",
			IsMain:     name == main,
			LastCommit: f[1],
		})
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	remotes, err := r.remoteBranches(main)
	if err != nil {
		return nil, err
	}
	branches = append(branches, remotes...)
	sortBranches(branches)
	return branches, nil
}

// remoteBranches lists remote-tracking branches as of the last fetch; it does not fetch.
func (r *Repo) remoteBranches(main string) ([]Branch, error) {
	out, err := r.run("for-each-ref", "--format=%(refname:short)\x1f%(symref)\x1f%(committerdate:iso-strict)", "refs/remotes")
	if err != nil {
		return nil, err
	}
	var branches []Branch
	sc := bufio.NewScanner(strings.NewReader(out))
	for sc.Scan() {
		line := sc.Text()
		if line == "" {
			continue
		}
		f := strings.Split(line, "\x1f")
		if len(f) != 3 {
			continue
		}
		// A non-empty symref is the origin/HEAD pointer, not a branch.
		if strings.TrimSpace(f[1]) != "" {
			continue
		}
		name := f[0]
		branches = append(branches, Branch{Name: name, IsMain: name == main, IsRemote: true, LastCommit: f[2]})
	}
	return branches, sc.Err()
}

var pinnedBranches = []string{"main", "master", "develop", "development", "dev", "staging"}

// branchRank puts the pinned trunks first; a remote ranks on the name after its remote,
// so origin/main heads the remotes the way main heads the locals.
func branchRank(b Branch) int {
	name := b.Name
	if b.IsRemote {
		if _, rest, found := strings.Cut(name, "/"); found {
			name = rest
		}
	}
	for i, p := range pinnedBranches {
		if name == p {
			return i
		}
	}
	return len(pinnedBranches)
}

// branchGroup is the prefix a branch sorts under: the segment before its first "/", or
// for a remote the segment after the remote name, which every remote branch shares.
func branchGroup(b Branch) string {
	name := b.Name
	if b.IsRemote {
		remote, rest, found := strings.Cut(name, "/")
		if !found {
			return name
		}
		seg, _, _ := strings.Cut(rest, "/")
		return remote + "/" + seg
	}
	seg, _, _ := strings.Cut(name, "/")
	return seg
}

func branchDate(b Branch) time.Time {
	t, err := time.Parse(time.RFC3339, b.LastCommit)
	if err != nil {
		return time.Time{} // unparseable/absent sorts oldest
	}
	return t
}

// sortBranches orders locals before remotes, pinned trunks first, then by activity —
// grouped by prefix, each group sitting at its newest member's date.
func sortBranches(branches []Branch) {
	// Partition by side, so a local named "origin/x" doesn't pool with the origin/x remotes.
	key := func(b Branch) string {
		if b.IsRemote {
			return "r\x00" + branchGroup(b)
		}
		return "l\x00" + branchGroup(b)
	}
	newest := map[string]time.Time{}
	for _, b := range branches {
		if d := branchDate(b); d.After(newest[key(b)]) {
			newest[key(b)] = d
		}
	}
	sort.SliceStable(branches, func(i, j int) bool {
		bi, bj := branches[i], branches[j]
		if bi.IsRemote != bj.IsRemote {
			return !bi.IsRemote
		}
		if ri, rj := branchRank(bi), branchRank(bj); ri != rj {
			return ri < rj
		}
		gi, gj := key(bi), key(bj)
		if gi != gj {
			if ni, nj := newest[gi], newest[gj]; !ni.Equal(nj) {
				return ni.After(nj)
			}
			return gi < gj // same newest date: keep it deterministic
		}
		if di, dj := branchDate(bi), branchDate(bj); !di.Equal(dj) {
			return di.After(dj)
		}
		return bi.Name < bj.Name
	})
}

func (r *Repo) MainBranch() string {
	for _, name := range []string{"main", "master"} {
		if _, err := r.run("rev-parse", "--verify", "--quiet", name); err == nil {
			return name
		}
	}
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
	// "" rather than a fabricated "main": callers then require an explicit base.
	return ""
}

// ErrNoMergeBase reports that two refs share no common ancestor.
var ErrNoMergeBase = errors.New("no common history")

func (r *Repo) MergeBase(a, b string) (string, error) {
	out, err := r.run("merge-base", a, b)
	if err != nil {
		// Exit 1 is "no merge base"; a bad ref or a broken repo exits 128.
		var ee *exec.ExitError
		if errors.As(err, &ee) && ee.ExitCode() == 1 {
			return "", fmt.Errorf("%w: %s and %s", ErrNoMergeBase, a, b)
		}
		return "", err
	}
	return strings.TrimSpace(out), nil
}

// ResolveSHA resolves ref to a commit sha; --verify fails cleanly on a missing ref.
func (r *Repo) ResolveSHA(ref string) (string, error) {
	out, err := r.run("rev-parse", "--verify", ref+"^{commit}")
	return strings.TrimSpace(out), err
}

// EmptyTreeSHA is git's canonical empty tree, the before side for a root commit.
const EmptyTreeSHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

// ParentSHA resolves ref's first parent, or EmptyTreeSHA for a root commit; one rev-list
// tells a root commit from a missing ref, where `rev-parse <ref>^` fails identically for both.
func (r *Repo) ParentSHA(ref string) (string, error) {
	out, err := r.run("rev-list", "--parents", "-n", "1", ref+"^{commit}")
	if err != nil {
		return "", err
	}
	// "<sha> [<parent>…]": no parent is a root commit; no sha at all is not "parentless".
	f := strings.Fields(out)
	switch len(f) {
	case 0:
		return "", fmt.Errorf("no commit for %q", ref)
	case 1:
		return EmptyTreeSHA, nil
	}
	return f[1], nil
}

// ErrNotFound reports that the path, or the ref itself, doesn't exist on the side asked for.
var ErrNotFound = errors.New("not found")

func (r *Repo) FileContent(ref, path string) (string, error) {
	return r.showObject(ref + ":" + path)
}

// IndexFile reads a path's staged (index) content.
func (r *Repo) IndexFile(path string) (string, error) {
	return r.showObject(":" + path)
}

// showObject reads a `<ref>:<path>` object; absence (ErrNotFound) is confirmed with
// `cat-file -e`, not by matching stderr, whose wording varies by git version and locale.
func (r *Repo) showObject(spec string) (string, error) {
	out, err := r.run("show", spec)
	if err != nil {
		if _, probe := r.run("cat-file", "-e", spec); probe != nil {
			return "", fmt.Errorf("%w: %v", ErrNotFound, err)
		}
	}
	return out, err
}

// BatchObjects reads many `<ref>:<path>` blobs in one `git cat-file --batch`, keyed by spec.
// Absent specs and non-blobs are left out; on error nothing was read, so absence means unknown.
func (r *Repo) BatchObjects(specs []string) (map[string]string, error) {
	out := map[string]string{}
	usable := make([]string, 0, len(specs))
	seen := map[string]bool{}
	for _, s := range specs {
		if s == "" || strings.ContainsAny(s, "\n\r") || seen[s] {
			continue
		}
		seen[s] = true
		usable = append(usable, s)
	}
	if len(usable) == 0 {
		return out, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), gitTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", "-C", r.Path, "cat-file", "--batch")
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	cmd.Env = append(cmd.Env, optionalLocksOff...)
	cmd.Stdin = strings.NewReader(strings.Join(usable, "\n") + "\n")
	var buf, errb bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &errb
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("git cat-file --batch: %w: %s", err, errb.String())
	}
	parseBatch(buf.Bytes(), usable, out)
	return out, nil
}

// parseBatch correlates cat-file --batch records to specs by position (a found record
// reports the oid, not the spec) and takes each payload by its declared size, never by delimiter.
func parseBatch(data []byte, specs []string, out map[string]string) {
	pos, i := 0, 0
	for pos < len(data) && i < len(specs) {
		nl := bytes.IndexByte(data[pos:], '\n')
		if nl < 0 {
			return
		}
		header := string(data[pos : pos+nl])
		pos += nl + 1

		fields := strings.Fields(header)
		if len(fields) != 3 {
			i++ // "missing"/"ambiguous": no payload follows, so just advance
			continue
		}
		size, err := strconv.Atoi(fields[2])
		if err != nil || size < 0 || pos+size > len(data) {
			return // truncated or unparseable: keep what we have rather than guess
		}
		// Blobs only: a raw tree is binary where `git show <ref>:<dir>` prints a listing, so let it fall through.
		if fields[1] == "blob" {
			out[specs[i]] = string(data[pos : pos+size])
		}
		pos += size + 1 // payload plus git's trailing newline
		i++
	}
}

// ListFiles returns the tracked file paths at ref; quotePath=false keeps non-ASCII paths verbatim, like diffArgs.
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

// RecentCommits lists up to limit commits of base..ref, newest first; an empty base lists ref's full ancestry.
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

// WorktreeFile reads path from the on-disk working tree, confined to the repo and kept out of .git.
func (r *Repo) WorktreeFile(path string) (string, error) {
	sep := string(filepath.Separator)
	clean := filepath.Clean(path)
	// A case-insensitive FS resolves ".GIT" to the real .git, so reject every case variant.
	if lower := strings.ToLower(clean); lower == ".git" || strings.HasPrefix(lower, ".git"+sep) {
		return "", fmt.Errorf("invalid path %q", path)
	}
	full := filepath.Join(r.Path, clean)
	// Resolve symlinks first, so an in-repo link pointing outward can't be followed out.
	root, err := filepath.EvalSymlinks(r.Path)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(full)
	if err != nil {
		return "", notFoundIfAbsent(err)
	}
	rel, err := filepath.Rel(root, resolved)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+sep) {
		return "", fmt.Errorf("invalid path %q", path)
	}
	// Re-check .git on the resolved path: a symlink into .git passes the textual check above.
	if lower := strings.ToLower(rel); lower == ".git" || strings.HasPrefix(lower, ".git"+sep) {
		return "", fmt.Errorf("invalid path %q", path)
	}
	b, err := os.ReadFile(resolved)
	if err != nil {
		return "", notFoundIfAbsent(err)
	}
	return string(b), nil
}

func notFoundIfAbsent(err error) error {
	if os.IsNotExist(err) {
		return fmt.Errorf("%w: %v", ErrNotFound, err)
	}
	return err
}

// WorktreeFingerprint is a content-free change signal — HEAD, the changed-path set and
// those paths' mtimes — so its cost stays flat however large the diff.
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
		// A deleted path fails to stat; "absent" is a stable stand-in.
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

// MapOldLine maps a 1-based old-side line to its new-side line; alive=false means it was deleted or modified.
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

// HunksOldExtent returns the highest old-side line the hunks touch; beyond it MapOldLine is a constant offset.
func HunksOldExtent(hunks []Hunk) int {
	max := 0
	for _, h := range hunks {
		oldStart, _ := parseHunkHeader(h.Header)
		old := oldStart
		for _, l := range h.Lines {
			if l.Kind == LineContext || l.Kind == LineDel {
				old++
			}
		}
		if last := old - 1; last > max { // old is one past the last covered line
			max = last
		}
	}
	return max
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
