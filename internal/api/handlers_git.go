// The read-only git endpoints: what repos and branches exist, what a branch
// changed, and the content of one file on one side of that change. None of them
// touch the store — a reviewer can browse a diff before a review row exists.
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
	// No separate "main" field: each Branch already carries IsMain (ListBranches
	// resolved it once to build them), and a second MainBranch() here re-ran up to
	// four git subprocesses to answer a question the list had already answered.
	writeJSON(w, map[string]any{"branches": branches})
}

// handleDiff computes the diff as two orthogonal axes (a transient view toggle).
// `from` sets the before side; the working-tree flags set the after side:
//
//	from=all|""   — merge-base(base,head) (whole branch); a commit sha → that
//	                commit's parent, i.e. inclusive: the picked commit's own
//	                changes are part of the diff
//	uncommitted   — false: after = head (committed range, from..head); true: the
//	                working tree or the git index
//	unstaged      — when uncommitted, true (default) → working tree (from + all
//	                uncommitted, incl. untracked); false → index (staged only)
//
// The returned "base" is the resolved `from` ref (the merge-base, or the picked
// commit's parent) — the before side for the image before/after blobs.
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
	// The diff is two orthogonal axes: `from` sets the before-side (the whole
	// branch's merge-base, or a picked commit — inclusive, so the before side is
	// that commit's parent), and the working-tree flags set the after-side (head
	// commit, working tree, or the git index).
	//
	//   uncommitted=false            → from .. head        (committed range)
	//   uncommitted=true  unstaged   → from .. working tree (staged + unstaged)
	//   uncommitted=true  !unstaged  → from .. index        (staged only)
	//
	// unstaged defaults to true, so a bare uncommitted flag includes everything.
	from := r.URL.Query().Get("from")
	uncommitted := r.URL.Query().Get("uncommitted") == "true"
	unstaged := r.URL.Query().Get("unstaged") != "false"

	var fromRef string
	if from == "" || from == "all" {
		// Whole branch: resolve base to its merge-base with head so the review shows
		// only what head introduces; default to the main branch when none is given.
		baseRef := r.URL.Query().Get("base")
		if baseRef != "" {
			if err := validRef(baseRef); err != nil {
				httpError(w, http.StatusBadRequest, err)
				return
			}
		}
		// Fall back to the main branch when no base is given or the given one no
		// longer resolves (a stale local "main", etc.).
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
		// Inclusive: "from <commit>" means the diff *starts at* that commit, so its
		// own changes show. That makes the before side its parent — and picking the
		// branch's oldest commit therefore equals `all` (its parent is the
		// merge-base), which is what a reviewer reading the picker expects.
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

// handleFiles lists the tracked files at ref, feeding the picker that lets a
// reviewer comment on a file the branch didn't change.
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

// handleCommits lists the commits the diff "from" picker can start at: those `ref`
// (head) introduces over `base` (base..ref), so the picker offers only the branch's
// own commits — never base-branch history behind the merge point. base defaults to
// the main branch; if none resolves it lists ref's full ancestry. limit defaults to
// 50 and is clamped to [1,200].
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
	// Fall back to the main branch when no base is given or the given one no longer
	// resolves; may still be "" (no trunk) → RecentCommits lists ref's full ancestry.
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

// readFileContent reads path from the side the query asks for. `fromWorktree`
// reports the side the content *actually* came from, which a ref read can't promise:
// the ref may lack a file that's on disk, and the caller has to say so rather than
// pass the on-disk copy off as the ref's content — that content is the new side of a
// diff the reader is comparing against, so an unlabelled substitution reads as the
// committed file and its lines look wrong for no visible reason.
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
	// The head side reads a ref, so it's the only one that needs one named.
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
		// Only *absence* falls back: the ref may legitimately lack a file that is on
		// disk (an uncommitted new file, or a stale mid-mode-switch request). A real
		// git failure must not take this path — answering it with the working-tree
		// copy would serve uncommitted content as if it were the ref's, against a
		// diff computed from the ref, and the view would render the wrong lines with
		// nothing to show for it.
		if wt, wtErr := repo.WorktreeFile(path); wtErr == nil {
			content, err, fromWorktree = wt, nil, true
		}
	}
	if err != nil {
		// A path can outlive the file it names — a comment anchored before a rename
		// or delete still asks for it — so absence is a 404 about the file, not a
		// server fault dressed up as a raw git error.
		if errors.Is(err, git.ErrNotFound) {
			httpError(w, http.StatusNotFound, fmt.Errorf("%s does not exist in %s", path, sideLabel(side, ref)))
			return "", "", false, false
		}
		httpError(w, http.StatusInternalServerError, err)
		return "", "", false, false
	}
	return content, path, fromWorktree, true
}

// The response's "ref" echoes what was asked for; "worktree" says where the content
// came from. They differ when the ref lacked the file and the on-disk copy stood in.
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
	// These are repo-controlled bytes: a malicious .svg with an inline <script> must
	// not execute if the blob URL is opened directly. A sandbox CSP (no scripts, no
	// network) + nosniff neutralizes it; the app only ever loads this via <img>, which
	// runs no SVG script regardless, so rendering is unaffected.
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

// Two refs with no common ancestor are a bad *selection*, not a server fault, so
// they answer 400 with prose naming both ends. Anything else stays a 500 carrying
// git's own message.
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

// resolveBase returns a base ref that actually resolves in repo: the given base if
// it does, else the repo's main branch (else ""). This tolerates a stale base —
// e.g. a local "main" that no longer exists (only origin/main) after checking out a
// remote branch — falling back to the auto default rather than failing the request
// with a raw "ambiguous argument 'main..head'" git error.
func resolveBase(repo *git.Repo, base string) string {
	if base != "" {
		if _, err := repo.ResolveSHA(base); err == nil {
			return base
		}
	}
	return repo.MainBranch()
}
