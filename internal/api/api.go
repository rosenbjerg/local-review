// Package api wires the HTTP handlers over the git service and store.
//
// The handlers are grouped by resource, one file each — handlers_git.go (the
// read-only git endpoints), handlers_reviews.go, handlers_comments.go (comments
// and their replies) — over the shared pieces here: the Server, the repo
// resolution every git-reading endpoint goes through, and the route table.
// respond.go holds the request/response plumbing, validate.go the input rules.
package api

import (
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"local-review/internal/git"
	"local-review/internal/store"
)

type Server struct {
	Root  string
	Store *store.Store
	hub   *hub
	watch *watchRegistry
}

func New(root string, st *store.Store) *Server {
	h := newHub()
	return &Server{Root: root, Store: st, hub: h, watch: newWatchRegistry(h)}
}

func isGitRepo(path string) bool {
	_, err := os.Stat(filepath.Join(path, ".git"))
	return err == nil
}

// repoInfo is one entry in the repo picker. LastActivity is a local calendar date
// (YYYY-MM-DD), deliberately *not* a timestamp: it is the value the ordering rests
// on, and a picker that re-ordered itself through the working day would be worse
// than an alphabetical one. Empty when the repo's activity can't be dated.
type repoInfo struct {
	Name         string `json:"name"`
	LastActivity string `json:"lastActivity"`
}

const activityDateLayout = "2006-01-02"

// repoActivityDate dates a repo by its reflog: `.git/logs/HEAD` is appended on every
// commit, checkout, merge and pull, so its mtime is when the reviewer last worked in
// this repo — which is what the picker wants, and what a stat can answer. Reading the
// newest committer date across the refs instead would be one git process per repo on
// an endpoint that lists them all, and would still miss checkouts and branch
// switches. Two fallbacks, both cheap: `.git` itself (also the case where it's a
// gitlink *file*, for a worktree or submodule, and so has no logs/ under it), then
// nothing — an undated repo sorts last rather than jumping around.
func repoActivityDate(path string) string {
	dotGit := filepath.Join(path, ".git")
	for _, p := range []string{filepath.Join(dotGit, "logs", "HEAD"), dotGit} {
		if fi, err := os.Stat(p); err == nil {
			return fi.ModTime().Local().Format(activityDateLayout)
		}
	}
	return ""
}

func (s *Server) listRepos() ([]repoInfo, error) {
	entries, err := os.ReadDir(s.Root)
	if err != nil {
		return nil, err
	}
	repos := []repoInfo{}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		path := filepath.Join(s.Root, e.Name())
		if isGitRepo(path) {
			repos = append(repos, repoInfo{Name: e.Name(), LastActivity: repoActivityDate(path)})
		}
	}
	// Most recently worked in first, by *date* only, then alphabetically: the two
	// repos you're switching between all day share a date, so they hold a stable
	// order instead of trading places on every commit. A YYYY-MM-DD compare is a
	// date compare, and an undated repo ("") sorts last.
	sort.SliceStable(repos, func(i, j int) bool {
		if repos[i].LastActivity != repos[j].LastActivity {
			return repos[i].LastActivity > repos[j].LastActivity
		}
		return repos[i].Name < repos[j].Name
	})
	return repos, nil
}

// Rejects anything that isn't a single path segment under the root — a
// path-traversal guard, so keep the segment check if you touch this.
func (s *Server) repoFor(name string) (*git.Repo, error) {
	if name == "" {
		return nil, errString("repo is required")
	}
	if name != filepath.Base(name) || name == "." || name == ".." || strings.ContainsAny(name, `/\`) {
		return nil, errString("invalid repo name")
	}
	abs := filepath.Join(s.Root, name)
	if !isGitRepo(abs) {
		return nil, errString("not a git repository: " + name)
	}
	// Confine to the root even when `name` is a symlink: resolve both sides and
	// confirm the target stays under root, so a symlink placed in the root can't
	// point the tool at a repo outside it (isGitRepo's os.Stat follows symlinks).
	root, rootErr := filepath.EvalSymlinks(s.Root)
	resolved, resErr := filepath.EvalSymlinks(abs)
	if rootErr != nil || resErr != nil {
		return nil, errString("invalid repo name")
	}
	sep := string(filepath.Separator)
	if rel, err := filepath.Rel(root, resolved); err != nil || rel == ".." || strings.HasPrefix(rel, ".."+sep) {
		return nil, errString("invalid repo name")
	}
	return git.New(abs), nil
}

func (s *Server) repoParam(w http.ResponseWriter, r *http.Request) (*git.Repo, bool) {
	repo, err := s.repoFor(r.URL.Query().Get("repo"))
	if err != nil {
		httpError(w, http.StatusBadRequest, err)
		return nil, false
	}
	return repo, true
}

func (s *Server) Routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/repos", s.handleRepos)
	mux.HandleFunc("GET /api/branches", s.handleBranches)
	mux.HandleFunc("GET /api/diff", s.handleDiff)
	mux.HandleFunc("GET /api/files", s.handleFiles)
	mux.HandleFunc("GET /api/commits", s.handleCommits)
	mux.HandleFunc("GET /api/file", s.handleFile)
	mux.HandleFunc("GET /api/blob", s.handleBlob)

	mux.HandleFunc("POST /api/reviews", s.handleCreateReview)
	mux.HandleFunc("GET /api/reviews", s.handleListReviews)
	mux.HandleFunc("GET /api/reviews/{id}", s.handleGetReview)
	mux.HandleFunc("GET /api/reviews/{id}/events", s.handleEvents)
	mux.HandleFunc("DELETE /api/reviews/{id}", s.handleDeleteReview)
	mux.HandleFunc("POST /api/reviews/{id}/export", s.handleExport)
	mux.HandleFunc("POST /api/reviews/{id}/reset", s.handleResetReview)
	mux.HandleFunc("POST /api/reviews/{id}/reviewed", s.handleSetReviewed)
	mux.HandleFunc("POST /api/reviews/{id}/summary", s.handleSetSummary)

	mux.HandleFunc("POST /api/reviews/{id}/comments", s.handleAddComment)
	mux.HandleFunc("GET /api/reviews/{id}/comments", s.handleListComments)
	mux.HandleFunc("PATCH /api/comments/{id}", s.handleUpdateComment)
	mux.HandleFunc("DELETE /api/comments/{id}", s.handleDeleteComment)
	mux.HandleFunc("POST /api/comments/{id}/resolved", s.handleSetResolved)

	mux.HandleFunc("POST /api/comments/{id}/replies", s.handleAddReply)
	mux.HandleFunc("PATCH /api/replies/{id}", s.handleUpdateReply)
	mux.HandleFunc("DELETE /api/replies/{id}", s.handleDeleteReply)
}
