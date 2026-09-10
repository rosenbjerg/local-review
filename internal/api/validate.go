// What the API refuses; these run before any repo or store read, so a bad request is a 400 on
// every side. They carry the status themselves — refusing input is the whole of their job.
package api

import (
	"path/filepath"
	"strings"

	"local-review/internal/store"
)

// validRef rejects empty refs and refs starting with "-", which git would read as a flag.
func validRef(ref string) error {
	if ref == "" {
		return badRequest(errString("empty ref"))
	}
	if strings.HasPrefix(ref, "-") {
		return badRequest(errString("invalid ref"))
	}
	return nil
}

// optionalRef validates a ref only when one was given, for the params that default instead.
func optionalRef(ref string) error {
	if ref == "" {
		return nil
	}
	return validRef(ref)
}

// validPath rejects what can't name a repo file: an absolute path, a ".." escape, or .git in
// any case variant, since a case-insensitive filesystem resolves ".GIT" to the real one.
func validPath(p string) error {
	if p == "" {
		return badRequest(errString("path is required"))
	}
	sep := string(filepath.Separator)
	clean := filepath.Clean(p)
	bad := filepath.IsAbs(clean) ||
		clean == ".." || strings.HasPrefix(clean, ".."+sep)
	if lower := strings.ToLower(clean); lower == ".git" || strings.HasPrefix(lower, ".git"+sep) {
		bad = true
	}
	if bad {
		return badRequestf("invalid path %q", p)
	}
	return nil
}

// validBody rejects a blank body, which would export as a heading with nothing under it.
func validBody(body string) error {
	if strings.TrimSpace(body) == "" {
		return badRequest(errString("body is required"))
	}
	return nil
}

// sideOf parses a side off a request field; every endpoint that takes one goes through
// here, so the check can't be present on one path and missing on another.
func sideOf(v string) (store.Side, error) {
	side, ok := store.ParseSide(v)
	if !ok {
		return side, badRequest(errString(`invalid side: want "head", "worktree" or "index"`))
	}
	return side, nil
}

func validCommentType(t store.CommentType) error {
	switch t {
	case store.CommentBug, store.CommentSuggestion, store.CommentQuestion, store.CommentNit:
		return nil
	}
	return badRequest(errString("invalid comment type"))
}

// validStartLine guards the anchor's lower bound; 0 is the file-level comment.
func validStartLine(n int) error {
	if n < 0 {
		return badRequest(errString("startLine must be >= 0"))
	}
	return nil
}

// sanitize turns a ref into a filename component; `"` and `\` go too, since the export's Content-Disposition quotes it.
func sanitize(s string) string {
	return strings.NewReplacer("/", "-", " ", "-", ":", "-", `"`, "-", `\`, "-").Replace(s)
}
