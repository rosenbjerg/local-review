// Caching git diff output across review reads. Re-anchoring shells out once per
// (commit_sha, path), and a review read runs on every SSE ping — so while head stands
// still that whole pass is pure repetition.
package review

import (
	"sync"
)

// maxGenerations bounds memory. Entries are only useful while head stands still, so a
// moved head retires a whole generation at once; four covers flipping between a repo or two.
const maxGenerations = 4

// DiffCache memoizes parsed `git diff <from> <to>` output across review reads. Both ends
// are resolved shas, so an entry can never go stale — it is only ever evicted. Safe for
// concurrent use: the SSE handlers and the worktree poller read through it at once, and a
// nil *DiffCache is a working no-op cache, which is what the one-comment paths pass.
type DiffCache struct {
	mu sync.Mutex
	// Keyed by repo path + head sha, so a head that moves retires its whole generation.
	gens map[string]map[string]*fileDiffResult
	// gens' keys, oldest first.
	order []string
}

func NewDiffCache() *DiffCache {
	return &DiffCache{gens: map[string]map[string]*fileDiffResult{}}
}

func (c *DiffCache) get(gen, key string) *fileDiffResult {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.gens[gen][key]
}

// put stores a result. Only successes reach here: a transient git failure (a mid-rebase
// worktree) must not become sticky across reads.
func (c *DiffCache) put(gen, key string, res *fileDiffResult) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	g := c.gens[gen]
	if g == nil {
		g = map[string]*fileDiffResult{}
		c.gens[gen] = g
		c.order = append(c.order, gen)
		for len(c.order) > maxGenerations {
			delete(c.gens, c.order[0])
			c.order = c.order[1:]
		}
	}
	g[key] = res
}
