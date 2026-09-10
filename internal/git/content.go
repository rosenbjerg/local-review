package git

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

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
	if err := parseBatch(buf.Bytes(), usable, out); err != nil {
		return nil, fmt.Errorf("git cat-file --batch: %w", err)
	}
	return out, nil
}

// parseBatch correlates cat-file --batch records to specs by position (a found record
// reports the oid, not the spec) and takes each payload by its declared size, never by delimiter.
// A record it cannot read fails the whole batch: callers read an unanswered spec as genuinely
// absent, so handing back a partial map would report live files as deleted.
func parseBatch(data []byte, specs []string, out map[string]string) error {
	pos, i := 0, 0
	for pos < len(data) && i < len(specs) {
		nl := bytes.IndexByte(data[pos:], '\n')
		if nl < 0 {
			return fmt.Errorf("truncated record header for %q", specs[i])
		}
		header := string(data[pos : pos+nl])
		pos += nl + 1

		fields := strings.Fields(header)
		// A terminator echoes the spec back before the reason, so a path with spaces makes the
		// field count meaningless; only the trailing word tells a terminator from a found record.
		if n := len(fields); n >= 2 && (fields[n-1] == "missing" || fields[n-1] == "ambiguous") {
			i++ // no payload follows, so just advance
			continue
		}
		if len(fields) != 3 {
			return fmt.Errorf("unparseable record header %q", header)
		}
		size, err := strconv.Atoi(fields[2])
		if err != nil || size < 0 || pos+size > len(data) {
			return fmt.Errorf("unparseable record header %q", header)
		}
		// Blobs only: a raw tree is binary where `git show <ref>:<dir>` prints a listing, so let it fall through.
		if fields[1] == "blob" {
			out[specs[i]] = string(data[pos : pos+size])
		}
		pos += size + 1 // payload plus git's trailing newline
		i++
	}
	return nil
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
