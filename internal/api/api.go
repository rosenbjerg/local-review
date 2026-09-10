// Package api wires the HTTP handlers over the git service and store.
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

// repoInfo is one repo-picker entry. LastActivity is a local YYYY-MM-DD date, not a
// timestamp, so the order can't reshuffle through the working day; empty if undatable.
type repoInfo struct {
	Name         string `json:"name"`
	LastActivity string `json:"lastActivity"`
}

const activityDateLayout = "2006-01-02"

// repoActivityDate dates a repo by its reflog's mtime — one stat, where reading the refs
// would spawn git per repo; a gitlink .git file has no logs/, hence the fallback.
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

// repoFor resolves a repo name under the root; the single-segment check is the path-traversal guard.
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
	// Resolve both sides' symlinks: isGitRepo's Stat follows links, so a symlink in
	// the root could otherwise point the tool at a repo outside it.
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
	mux.HandleFunc("GET /api/reviews/{id}", s.handleGetReview)
	mux.HandleFunc("GET /api/reviews/{id}/events", s.handleEvents)
	mux.HandleFunc("POST /api/reviews/{id}/export", s.handleExport)
	mux.HandleFunc("POST /api/reviews/{id}/export.md", s.handleExportMarkdown)
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
