// The read-only git endpoints; none touch the store, so a diff can be browsed before a review exists.
package api

import (
	"errors"
	"fmt"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"local-review/internal/git"
	"local-review/internal/store"
)

func (s *Server) handleRepos(w http.ResponseWriter, r *http.Request) {
	repos, err := s.listRepos()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, map[string]any{"repos": repos})
}

func (s *Server) handleBranches(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.repoParam(w, r)
	if !ok {
		return
	}
	branches, err := repo.ListBranches()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	// No separate "main" field: each Branch carries IsMain, and MainBranch() is up to four git processes.
	writeJSON(w, map[string]any{"branches": branches})
}

// handleDiff diffs `from` (all → merge-base(base, head); a sha → its parent, so that commit's
// own changes show) against head, the working tree or the index per uncommitted/unstaged.
func (s *Server) handleDiff(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.repoParam(w, r)
	if !ok {
		return
	}
	head := r.URL.Query().Get("head")
	if err := validRef(head); err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	from := r.URL.Query().Get("from")
	uncommitted := r.URL.Query().Get("uncommitted") == "true"
	unstaged := r.URL.Query().Get("unstaged") != "false"

	var fromRef string
	if from == "" || from == "all" {
		baseRef := r.URL.Query().Get("base")
		if baseRef != "" {
			if err := validRef(baseRef); err != nil {
				httpError(w, http.StatusBadRequest, err)
				return
			}
		}
		baseRef = resolveBase(repo, baseRef)
		if baseRef == "" {
			httpError(w, http.StatusBadRequest, errString("no main or master branch found; select a base branch"))
			return
		}
		mb, mbErr := repo.MergeBase(baseRef, head)
		if mbErr != nil {
			httpError(w, mergeBaseStatus(mbErr), mergeBaseError(mbErr, baseRef, head))
			return
		}
		fromRef = mb
	} else {
		if err := validRef(from); err != nil {
			httpError(w, http.StatusBadRequest, err)
			return
		}
		sha, shaErr := repo.ParentSHA(from)
		if shaErr != nil {
			httpError(w, http.StatusBadRequest, errString("unknown commit: "+from))
			return
		}
		fromRef = sha
	}

	var (
		diff []git.FileDiff
		err  error
	)
	switch {
	case !uncommitted:
		diff, err = repo.Diff(fromRef, head)
	case unstaged:
		diff, err = repo.DiffWorktree(fromRef)
	default:
		diff, err = repo.DiffStaged(fromRef)
	}
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, map[string]any{"base": fromRef, "head": head, "files": diff})
}

// handleFiles lists the tracked files at ref, for commenting on a file the branch didn't change.
func (s *Server) handleFiles(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.repoParam(w, r)
	if !ok {
		return
	}
	ref := r.URL.Query().Get("ref")
	if err := validRef(ref); err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	files, err := repo.ListFiles(ref)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, map[string]any{"files": files})
}

// handleCommits lists base..ref (the branch's own commits) for the "from" picker; with no
// resolvable base it lists ref's full ancestry.
func (s *Server) handleCommits(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.repoParam(w, r)
	if !ok {
		return
	}
	ref := r.URL.Query().Get("ref")
	if err := validRef(ref); err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	base := r.URL.Query().Get("base")
	if base != "" {
		if err := validRef(base); err != nil {
			httpError(w, http.StatusBadRequest, err)
			return
		}
	}
	base = resolveBase(repo, base)
	limit := 50
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 {
		limit = min(n, 200)
	}
	commits, err := repo.RecentCommits(base, ref, limit)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, map[string]any{"commits": commits})
}

// readFileContent reads path from the requested side; fromWorktree reports where the content
// actually came from, since a ref read may have fallen back to the on-disk copy.
func (s *Server) readFileContent(w http.ResponseWriter, r *http.Request) (content, path string, fromWorktree, ok bool) {
	repo, ok := s.repoParam(w, r)
	if !ok {
		return "", "", false, false
	}
	path = r.URL.Query().Get("path")
	if err := validPath(path); err != nil {
		httpError(w, http.StatusBadRequest, err)
		return "", "", false, false
	}
	side, err := sideOf(r.URL.Query().Get("side"))
	if err != nil {
		httpError(w, http.StatusBadRequest, err)
		return "", "", false, false
	}
	// Only the head side reads a ref.
	ref := r.URL.Query().Get("ref")
	if side.IsHead() {
		if err := validRef(ref); err != nil {
			httpError(w, http.StatusBadRequest, err)
			return "", "", false, false
		}
	}
	content, err = readSide(repo, ref, path, side)
	fromWorktree = side == store.SideWorktree
	if side.IsHead() && errors.Is(err, git.ErrNotFound) {
		// Only absence falls back: a real git failure answered with the on-disk copy would
		// render uncommitted text against hunks computed from the ref.
		if wt, wtErr := repo.WorktreeFile(path); wtErr == nil {
			content, err, fromWorktree = wt, nil, true
		}
	}
	if err != nil {
		// A path can outlive its file (a comment anchored before a rename or delete), so absence is a 404, not a 500.
		if errors.Is(err, git.ErrNotFound) {
			httpError(w, http.StatusNotFound, fmt.Errorf("%s does not exist in %s", path, sideLabel(side, ref)))
			return "", "", false, false
		}
		httpError(w, http.StatusInternalServerError, err)
		return "", "", false, false
	}
	return content, path, fromWorktree, true
}

// "ref" echoes what was asked for; "worktree" says where the content actually came from.
func (s *Server) handleFile(w http.ResponseWriter, r *http.Request) {
	content, path, fromWorktree, ok := s.readFileContent(w, r)
	if !ok {
		return
	}
	writeJSON(w, map[string]any{
		"path":     path,
		"ref":      r.URL.Query().Get("ref"),
		"content":  content,
		"worktree": fromWorktree,
	})
}

func (s *Server) handleBlob(w http.ResponseWriter, r *http.Request) {
	content, path, _, ok := s.readFileContent(w, r)
	if !ok {
		return
	}
	w.Header().Set("Content-Type", mimeForPath(path))
	w.Header().Set("Cache-Control", "no-cache")
	// Repo-controlled bytes: the sandbox CSP + nosniff keep an SVG's inline <script> from
	// running if the blob URL is opened directly; <img> loads are unaffected.
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; sandbox")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write([]byte(content))
}

func mimeForPath(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	case ".ico":
		return "image/x-icon"
	case ".avif":
		return "image/avif"
	case ".svg":
		return "image/svg+xml"
	}
	if t := mime.TypeByExtension(filepath.Ext(path)); t != "" {
		return t
	}
	return "application/octet-stream"
}

// Two refs with no common ancestor are a bad selection (400 with prose), not a server fault (500).
func mergeBaseStatus(err error) int {
	if errors.Is(err, git.ErrNoMergeBase) {
		return http.StatusBadRequest
	}
	return http.StatusInternalServerError
}

func mergeBaseError(err error, base, head string) error {
	if errors.Is(err, git.ErrNoMergeBase) {
		return fmt.Errorf("%s and %s share no common history — pick a base branch the work was started from", head, base)
	}
	return err
}

// resolveBase returns base if it resolves, else the repo's main branch (else ""), so a
// stale local "main" falls back to the auto default instead of a raw git error.
func resolveBase(repo *git.Repo, base string) string {
	if base != "" {
		if _, err := repo.ResolveSHA(base); err == nil {
			return base
		}
	}
	return repo.MainBranch()
}
