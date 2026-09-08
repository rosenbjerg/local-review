package api

import (
	"local-review/internal/git"
	"local-review/internal/store"
)

// readSide is the one place a store.Side maps to a git read: snippet capture and the
// staleness check must read the same side, or a comment reads as drifted when written.
func readSide(repo *git.Repo, headRef, path string, side store.Side) (string, error) {
	switch side {
	case store.SideIndex:
		return repo.IndexFile(path)
	case store.SideWorktree:
		return repo.WorktreeFile(path)
	default:
		return repo.FileContent(headRef, path)
	}
}

// sideLabel names a side in prose, for the 404 and the file card's substitution note.
func sideLabel(side store.Side, headRef string) string {
	switch side {
	case store.SideIndex:
		return "the git index"
	case store.SideWorktree:
		return "the working tree"
	default:
		return headRef
	}
}

// sideOf parses a side off a request field; every endpoint that takes one goes through
// here, so the check can't be present on one path and missing on another.
func sideOf(v string) (store.Side, error) {
	side, ok := store.ParseSide(v)
	if !ok {
		return side, errString(`invalid side: want "head", "worktree" or "index"`)
	}
	return side, nil
}
