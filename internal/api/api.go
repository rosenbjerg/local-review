// Package api wires the HTTP handlers over the git service and store.
package api

import (
	"net/http"

	"local-review/internal/git"
	"local-review/internal/store"
	"local-review/internal/workspace"
)

type Server struct {
	Store *store.Store
	repos *workspace.Workspace
	hub   *hub
	watch *watchRegistry
}

func New(root string, st *store.Store) *Server {
	h := newHub()
	return &Server{Store: st, repos: workspace.New(root), hub: h, watch: newWatchRegistry(h)}
}

// repoParam resolves the `repo` query param. Every failure here is the client naming a
// repo the server won't serve, so they are all 400s.
func (s *Server) repoParam(r *http.Request) (*git.Repo, error) {
	repo, err := s.repos.Open(r.URL.Query().Get("repo"))
	if err != nil {
		return nil, badRequest(err)
	}
	return repo, nil
}

// Routes wires every handler through handle(), so a failure is written in exactly one place.
func (s *Server) Routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/repos", handle(s.handleRepos))
	mux.HandleFunc("GET /api/branches", handle(s.handleBranches))
	mux.HandleFunc("GET /api/diff", handle(s.handleDiff))
	mux.HandleFunc("GET /api/files", handle(s.handleFiles))
	mux.HandleFunc("GET /api/commits", handle(s.handleCommits))
	mux.HandleFunc("GET /api/file", handle(s.handleFile))
	mux.HandleFunc("GET /api/blob", handle(s.handleBlob))

	mux.HandleFunc("POST /api/reviews", handle(s.handleCreateReview))
	mux.HandleFunc("GET /api/reviews/{id}", handle(s.handleGetReview))
	mux.HandleFunc("GET /api/reviews/{id}/events", handle(s.handleEvents))
	mux.HandleFunc("POST /api/reviews/{id}/export", handle(s.handleExport))
	mux.HandleFunc("POST /api/reviews/{id}/export.md", handle(s.handleExportMarkdown))
	mux.HandleFunc("POST /api/reviews/{id}/reset", handle(s.handleResetReview))
	mux.HandleFunc("POST /api/reviews/{id}/reviewed", handle(s.handleSetReviewed))
	mux.HandleFunc("POST /api/reviews/{id}/summary", handle(s.handleSetSummary))

	mux.HandleFunc("POST /api/reviews/{id}/comments", handle(s.handleAddComment))
	mux.HandleFunc("GET /api/reviews/{id}/comments", handle(s.handleListComments))
	mux.HandleFunc("PATCH /api/comments/{id}", handle(s.handleUpdateComment))
	mux.HandleFunc("DELETE /api/comments/{id}", handle(s.handleDeleteComment))
	mux.HandleFunc("POST /api/comments/{id}/resolved", handle(s.handleSetResolved))

	mux.HandleFunc("POST /api/comments/{id}/replies", handle(s.handleAddReply))
	mux.HandleFunc("PATCH /api/replies/{id}", handle(s.handleUpdateReply))
	mux.HandleFunc("DELETE /api/replies/{id}", handle(s.handleDeleteReply))
}
