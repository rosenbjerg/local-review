// Package workspace confines the tool to one root directory: it lists the git repositories
// under that root and resolves a repo name to a path that provably lives inside it. Every
// git-reading request passes through Open, so this is the boundary that keeps a served
// instance from being talked into reading somewhere else on disk.
package workspace

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"local-review/internal/git"
)

type Workspace struct {
	Root string
}

func New(root string) *Workspace { return &Workspace{Root: root} }

// Entry is one repo-picker row. LastActivity is a local YYYY-MM-DD date, not a
// timestamp, so the order can't reshuffle through the working day; empty if undatable.
type Entry struct {
	Name         string `json:"name"`
	LastActivity string `json:"lastActivity"`
}

const activityDateLayout = "2006-01-02"

// List returns the git repositories directly under the root, newest-worked-in first.
func (w *Workspace) List() ([]Entry, error) {
	entries, err := os.ReadDir(w.Root)
	if err != nil {
		return nil, err
	}
	repos := []Entry{}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		path := filepath.Join(w.Root, e.Name())
		if git.IsRepo(path) {
			repos = append(repos, Entry{Name: e.Name(), LastActivity: activityDate(path)})
		}
	}
	// By date (not timestamp) then name, so repos worked in on the same day hold a
	// stable order; an undated repo ("") sorts last.
	sort.SliceStable(repos, func(i, j int) bool {
		if repos[i].LastActivity != repos[j].LastActivity {
			return repos[i].LastActivity > repos[j].LastActivity
		}
		return repos[i].Name < repos[j].Name
	})
	return repos, nil
}

// activityDate dates a repo by its reflog's mtime — one stat, where reading the refs
// would spawn git per repo; a gitlink .git file has no logs/, hence the fallback.
func activityDate(path string) string {
	dotGit := filepath.Join(path, ".git")
	for _, p := range []string{filepath.Join(dotGit, "logs", "HEAD"), dotGit} {
		if fi, err := os.Stat(p); err == nil {
			return fi.ModTime().Local().Format(activityDateLayout)
		}
	}
	return ""
}

// ErrInvalidName rejects a name that can't safely address a repo under the root. It is
// deliberately the same error for a traversal attempt and for a symlink escape, so the
// response never reports what does or doesn't exist outside the root.
var ErrInvalidName = errors.New("invalid repo name")

// Open resolves a repo name under the root; the single-segment check is the path-traversal
// guard, and the symlink resolution below is what closes the rest.
func (w *Workspace) Open(name string) (*git.Repo, error) {
	if name == "" {
		return nil, errors.New("repo is required")
	}
	if name != filepath.Base(name) || name == "." || name == ".." || strings.ContainsAny(name, `/\`) {
		return nil, ErrInvalidName
	}
	abs := filepath.Join(w.Root, name)
	if !git.IsRepo(abs) {
		return nil, errors.New("not a git repository: " + name)
	}
	// Resolve both sides' symlinks: git.IsRepo's Stat follows links, so a symlink in
	// the root could otherwise point the tool at a repo outside it.
	root, rootErr := filepath.EvalSymlinks(w.Root)
	resolved, resErr := filepath.EvalSymlinks(abs)
	if rootErr != nil || resErr != nil {
		return nil, ErrInvalidName
	}
	sep := string(filepath.Separator)
	if rel, err := filepath.Rel(root, resolved); err != nil || rel == ".." || strings.HasPrefix(rel, ".."+sep) {
		return nil, ErrInvalidName
	}
	return git.New(abs), nil
}
