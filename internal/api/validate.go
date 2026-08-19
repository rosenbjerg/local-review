// What the API refuses. These run before anything reads a repo or the store, so
// a malformed request answers the same 400 whichever side would have rejected it.
package api

import (
	"fmt"
	"path/filepath"
	"strings"

	"local-review/internal/store"
)

// validRef rejects empty refs and refs starting with "-" (which git would treat
// as a flag, e.g. "--output=/path"); legitimate ref names never start with "-".
func validRef(ref string) error {
	if ref == "" {
		return errString("empty ref")
	}
	if strings.HasPrefix(ref, "-") {
		return errString("invalid ref")
	}
	return nil
}

// validPath rejects what can't name a file inside the repo: an absolute path, a
// ".." escape, or .git itself (in any case variant — a case-insensitive filesystem
// resolves ".GIT" to the real one). Malformed input is the caller's mistake, so it
// answers 400 on every side rather than reaching a read and surfacing as whatever
// that side's failure happens to be. git.WorktreeFile guards the same ground for
// paths that reach it from elsewhere.
func validPath(p string) error {
	if p == "" {
		return errString("path is required")
	}
	sep := string(filepath.Separator)
	clean := filepath.Clean(p)
	bad := filepath.IsAbs(clean) ||
		clean == ".." || strings.HasPrefix(clean, ".."+sep)
	if lower := strings.ToLower(clean); lower == ".git" || strings.HasPrefix(lower, ".git"+sep) {
		bad = true
	}
	if bad {
		return fmt.Errorf("invalid path %q", p)
	}
	return nil
}

// validBody rejects a comment/reply body with no text in it. An empty body reaches
// the export as a heading with nothing under it — a thread that says nothing but
// still counts toward the review — and the browser already refuses to submit one
// (CommentComposer trims and disables), so this only closes the raw API path.
func validBody(body string) error {
	if strings.TrimSpace(body) == "" {
		return errString("body is required")
	}
	return nil
}

func validCommentType(t store.CommentType) bool {
	switch t {
	case store.CommentBug, store.CommentSuggestion, store.CommentQuestion, store.CommentNit:
		return true
	}
	return false
}

func sanitize(s string) string {
	return strings.NewReplacer("/", "-", " ", "-", ":", "-").Replace(s)
}
