// The read-only git endpoints; none touch the store, so a diff can be browsed before a review exists.
package api

import (
	"errors"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"local-review/internal/git"
	"local-review/internal/store"
)

func (s *Server) handleRepos(w http.ResponseWriter, r *http.Request) error {
	repos, err := s.listRepos()
	if err != nil {
		return err
	}
	return writeJSON(w, map[string]any{"repos": repos})
}

func (s *Server) handleBranches(w http.ResponseWriter, r *http.Request) error {
	repo, err := s.repoParam(r)
	if err != nil {
		return err
	}
	branches, err := repo.ListBranches()
	if err != nil {
		return err
	}
	// No separate "main" field: each Branch carries IsMain, and MainBranch() is up to four git processes.
	return writeJSON(w, map[string]any{"branches": branches})
}

// handleDiff diffs `from` (all → merge-base(base, head); a sha → its parent, so that commit's
// own changes show) against head, the working tree or the index per uncommitted/unstaged.
func (s *Server) handleDiff(w http.ResponseWriter, r *http.Request) error {
	repo, err := s.repoParam(r)
	if err != nil {
		return err
	}
	head := r.URL.Query().Get("head")
	if err := validRef(head); err != nil {
		return err
	}
	from := r.URL.Query().Get("from")
	uncommitted := r.URL.Query().Get("uncommitted") == "true"
	unstaged := r.URL.Query().Get("unstaged") != "false"

	var fromRef string
	if from == "" || from == "all" {
		baseRef := r.URL.Query().Get("base")
		if err := optionalRef(baseRef); err != nil {
			return err
		}
		baseRef, err = resolveBaseRef(repo, baseRef)
		if err != nil {
			return err
		}
		mb, err := repo.MergeBase(baseRef, head)
		if err != nil {
			return mergeBaseError(err, baseRef, head)
		}
		fromRef = mb
	} else {
		if err := validRef(from); err != nil {
			return err
		}
		sha, err := repo.ParentSHA(from)
		if err != nil {
			return badRequestf("unknown commit: %s", from)
		}
		fromRef = sha
	}

	var diff []git.FileDiff
	switch {
	case !uncommitted:
		diff, err = repo.Diff(fromRef, head)
	case unstaged:
		diff, err = repo.DiffWorktree(fromRef)
	default:
		diff, err = repo.DiffStaged(fromRef)
	}
	if err != nil {
		return err
	}
	return writeJSON(w, map[string]any{"base": fromRef, "head": head, "files": diff})
}

// handleFiles lists the tracked files at ref, for commenting on a file the branch didn't change.
func (s *Server) handleFiles(w http.ResponseWriter, r *http.Request) error {
	repo, err := s.repoParam(r)
	if err != nil {
		return err
	}
	ref := r.URL.Query().Get("ref")
	if err := validRef(ref); err != nil {
		return err
	}
	files, err := repo.ListFiles(ref)
	if err != nil {
		return err
	}
	return writeJSON(w, map[string]any{"files": files})
}

// handleCommits lists base..ref (the branch's own commits) for the "from" picker; with no
// resolvable base it lists ref's full ancestry.
func (s *Server) handleCommits(w http.ResponseWriter, r *http.Request) error {
	repo, err := s.repoParam(r)
	if err != nil {
		return err
	}
	ref := r.URL.Query().Get("ref")
	if err := validRef(ref); err != nil {
		return err
	}
	base := r.URL.Query().Get("base")
	if err := optionalRef(base); err != nil {
		return err
	}
	limit := 50
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 {
		limit = min(n, 200)
	}
	// Unlike diff and create-review, no resolvable base is not an error here: the picker
	// then lists ref's whole ancestry rather than refusing to open.
	commits, err := repo.RecentCommits(resolveBase(repo, base), ref, limit)
	if err != nil {
		return err
	}
	return writeJSON(w, map[string]any{"commits": commits})
}

// readFileContent reads path from the requested side; fromWorktree reports where the content
// actually came from, since a ref read may have fallen back to the on-disk copy.
func (s *Server) readFileContent(r *http.Request) (content, path string, fromWorktree bool, err error) {
	repo, err := s.repoParam(r)
	if err != nil {
		return "", "", false, err
	}
	path = r.URL.Query().Get("path")
	if err := validPath(path); err != nil {
		return "", "", false, err
	}
	side, err := sideOf(r.URL.Query().Get("side"))
	if err != nil {
		return "", "", false, err
	}
	// Only the head side reads a ref.
	ref := r.URL.Query().Get("ref")
	if side.IsHead() {
		if err := validRef(ref); err != nil {
			return "", "", false, err
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
			return "", "", false, notFoundf("%s does not exist in %s", path, sideLabel(side, ref))
		}
		return "", "", false, err
	}
	return content, path, fromWorktree, nil
}

// "ref" echoes what was asked for; "worktree" says where the content actually came from.
func (s *Server) handleFile(w http.ResponseWriter, r *http.Request) error {
	content, path, fromWorktree, err := s.readFileContent(r)
	if err != nil {
		return err
	}
	return writeJSON(w, map[string]any{
		"path":     path,
		"ref":      r.URL.Query().Get("ref"),
		"content":  content,
		"worktree": fromWorktree,
	})
}

func (s *Server) handleBlob(w http.ResponseWriter, r *http.Request) error {
	content, path, _, err := s.readFileContent(r)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", mimeForPath(path))
	w.Header().Set("Cache-Control", "no-cache")
	// Repo-controlled bytes: the sandbox CSP + nosniff keep an SVG's inline <script> from
	// running if the blob URL is opened directly; <img> loads are unaffected.
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; sandbox")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write([]byte(content))
	return nil
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
func mergeBaseError(err error, base, head string) error {
	if errors.Is(err, git.ErrNoMergeBase) {
		return badRequestf("%s and %s share no common history — pick a base branch the work was started from", head, base)
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

// resolveBaseRef is resolveBase for the callers that cannot proceed without one.
func resolveBaseRef(repo *git.Repo, base string) (string, error) {
	if ref := resolveBase(repo, base); ref != "" {
		return ref, nil
	}
	return "", badRequest(errString("no main or master branch found; select a base branch"))
}
