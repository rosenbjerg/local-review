package api

import (
	"local-review/internal/git"
	"local-review/internal/store"
)

// readSide reads path from one side of the repo: the single place that maps a
// store.Side to the git read serving it.
//
// This switch used to exist three times over — in readFileContent, in
// contentCache.entry and in captureSnippet — each spelled with the same pair of
// booleans. They have to agree: the snippet capture and the staleness check must
// read the same side or a comment reads as drifted the moment it's written. One
// copy is what makes that structural instead of a convention.
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

// sideLabel names a side in prose, for the 404 that says where a path wasn't
// found and for the note the file card shows when the ref couldn't supply it.
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

// sideOf reads the anchor side off a request field, rejecting an unrecognized
// value. Every write that anchors something (a comment, a reviewed mark) and
// every read that has to pick a side goes through here, so the check can't be
// present on one path and missing on another — which is exactly what happened
// while the side travelled as two booleans: add-comment refused the impossible
// "both", and set-reviewed accepted it.
func sideOf(v string) (store.Side, error) {
	side, ok := store.ParseSide(v)
	if !ok {
		return side, errString(`invalid side: want "head", "worktree" or "index"`)
	}
	return side, nil
}
