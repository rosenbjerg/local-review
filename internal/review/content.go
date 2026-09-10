// Reading a file from the side its anchor was captured on, and caching those reads.
package review

import (
	"local-review/internal/git"
	"local-review/internal/store"
)

// ReadSide is the one place a store.Side maps to a git read: snippet capture and the
// staleness check must read the same side, or a comment reads as drifted when written.
func ReadSide(repo *git.Repo, headRef, path string, side store.Side) (string, error) {
	switch side {
	case store.SideIndex:
		return repo.IndexFile(path)
	case store.SideWorktree:
		return repo.WorktreeFile(path)
	default:
		return repo.FileContent(headRef, path)
	}
}

// SideLabel names a side in prose, for the 404 and the file card's substitution note.
func SideLabel(side store.Side, headRef string) string {
	switch side {
	case store.SideIndex:
		return "the git index"
	case store.SideWorktree:
		return "the working tree"
	default:
		return headRef
	}
}

// contentCache reads file content once per (side, path), warming the two git-backed sides
// in one command each: a review read runs continuously while an agent works, and spawn is the cost.
type contentCache struct {
	repo    *git.Repo
	headRef string
	sides   map[store.Side]map[string]*contentEntry
}

type contentEntry struct {
	content string
	ok      bool
	// split lazily, once, however many comments the file carries
	lines []string
	split bool
}

func newContentCache(repo *git.Repo, headRef string) *contentCache {
	return &contentCache{repo: repo, headRef: headRef, sides: map[store.Side]map[string]*contentEntry{}}
}

func (c *contentCache) side(s store.Side) map[string]*contentEntry {
	if c.sides[s] == nil {
		c.sides[s] = map[string]*contentEntry{}
	}
	return c.sides[s]
}

// spec is the `<ref>:<path>` form cat-file and `git show` share; the working tree has none and reads per file.
func (c *contentCache) spec(path string, s store.Side) string {
	if s == store.SideIndex {
		return ":" + path
	}
	return c.headRef + ":" + path
}

// warm prefetches one object-database side in a single command; a failed batch leaves the
// cache cold, not poisoned, so entry() falls back to the per-file read.
func (c *contentCache) warm(paths []string, s store.Side) {
	if s == store.SideWorktree || len(paths) == 0 {
		return
	}
	specs := make([]string, 0, len(paths))
	for _, p := range paths {
		specs = append(specs, c.spec(p, s))
	}
	objs, err := c.repo.BatchObjects(specs)
	if err != nil {
		return
	}
	side := c.side(s)
	for _, p := range paths {
		if _, seeded := side[p]; seeded {
			continue
		}
		// The batch ran, so an unanswered spec is genuinely absent; record that too, or every
		// missing file still costs a process to rediscover.
		if content, found := objs[c.spec(p, s)]; found {
			side[p] = &contentEntry{content: content, ok: true}
		} else {
			side[p] = &contentEntry{ok: false}
		}
	}
}

func (c *contentCache) entry(path string, s store.Side) *contentEntry {
	side := c.side(s)
	if e, ok := side[path]; ok {
		return e
	}
	content, err := ReadSide(c.repo, c.headRef, path, s)
	e := &contentEntry{content: content, ok: err == nil}
	if err != nil {
		e.content = ""
	}
	side[path] = e
	return e
}

func (c *contentCache) read(path string, s store.Side) (string, bool) {
	e := c.entry(path, s)
	return e.content, e.ok
}

// lines is read() split for snippet matching, memoised on the entry.
func (c *contentCache) lines(path string, s store.Side) ([]string, bool) {
	e := c.entry(path, s)
	if !e.ok {
		return nil, false
	}
	if !e.split {
		e.lines, e.split = splitLines(e.content), true
	}
	return e.lines, true
}
