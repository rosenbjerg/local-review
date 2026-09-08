// What the API refuses; these run before any repo or store read, so a bad request is a 400 on every side.
package api

import (
	"fmt"
	"path/filepath"
	"strings"

	"local-review/internal/store"
)

// validRef rejects empty refs and refs starting with "-", which git would read as a flag.
func validRef(ref string) error {
	if ref == "" {
		return errString("empty ref")
	}
	if strings.HasPrefix(ref, "-") {
		return errString("invalid ref")
	}
	return nil
}

// validPath rejects what can't name a repo file: an absolute path, a ".." escape, or .git in
// any case variant, since a case-insensitive filesystem resolves ".GIT" to the real one.
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

// validBody rejects a blank body, which would export as a heading with nothing under it.
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

// sanitize turns a ref into a filename component; `"` and `\` go too, since the export's Content-Disposition quotes it.
func sanitize(s string) string {
	return strings.NewReplacer("/", "-", " ", "-", ":", "-", `"`, "-", `\`, "-").Replace(s)
}
