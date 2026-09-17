package api

import (
	"testing"
	"time"
)

// Reading the refs is two git processes, and the poller ticks every 1.5s for as long as a tab
// is open — so on a repository nobody is touching it was most of the cost of watching. It can
// be skipped because everything that moves a ref *and* matters promptly (a commit, a rebase,
// a checkout) moves the worktree too; only a bare `git fetch` moves refs alone, and noticing
// that within a refsInterval is soon enough.
func TestRefsDue(t *testing.T) {
	cases := []struct {
		name      string
		seeded    bool
		movedTree bool
		since     time.Duration
		want      bool
	}{
		{"the first tick has no baseline to compare against", false, false, 0, true},
		{"a still worktree, just polled", true, false, 0, false},
		{"a still worktree, well inside the interval", true, false, refsInterval - time.Second, false},
		{"a still worktree, interval elapsed", true, false, refsInterval, true},
		{"a still worktree, long overdue", true, false, 10 * refsInterval, true},
		// A commit empties the change set and a checkout rewrites mtimes, so the worktree moving
		// is what says "this may have been a ref move" — and the client is told which it was.
		{"the worktree moved, just polled", true, true, 0, true},
	}
	for _, c := range cases {
		if got := refsDue(c.seeded, c.movedTree, c.since); got != c.want {
			t.Errorf("%s: refsDue(%v, %v, %v) = %v, want %v", c.name, c.seeded, c.movedTree, c.since, got, c.want)
		}
	}
}
