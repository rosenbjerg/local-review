package api

import (
	"context"
	"sync"
	"time"

	"local-review/internal/git"
)

const watchInterval = 1500 * time.Millisecond

// How long the poller will go without re-reading the refs while the worktree stands still. A
// commit or a checkout shows in the worktree too, so the refs only need their own cadence for
// the one thing that touches nothing else — a bare `git fetch` — and reading them costs two
// processes, which is most of the price of watching a repository where nothing is happening.
const refsInterval = 12 * time.Second

// watchRegistry runs one ref-counted poller per review with live SSE subscribers, turning
// out-of-band edits into `diff` pings and ref moves into `refs` pings.
type watchRegistry struct {
	hub    *hub
	mu     sync.Mutex
	active map[int64]*watchEntry
}

type watchEntry struct {
	refs   int
	cancel context.CancelFunc
}

func newWatchRegistry(hub *hub) *watchRegistry {
	return &watchRegistry{hub: hub, active: map[int64]*watchEntry{}}
}

// start adds one subscriber, spawning the poller on the first; every start must be paired with a stop.
func (wr *watchRegistry) start(reviewID int64, repoPath string) {
	wr.mu.Lock()
	defer wr.mu.Unlock()
	if e := wr.active[reviewID]; e != nil {
		e.refs++
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	wr.active[reviewID] = &watchEntry{refs: 1, cancel: cancel}
	go wr.poll(ctx, reviewID, repoPath)
}

func (wr *watchRegistry) stop(reviewID int64) {
	wr.mu.Lock()
	defer wr.mu.Unlock()
	e := wr.active[reviewID]
	if e == nil {
		return
	}
	e.refs--
	if e.refs <= 0 {
		e.cancel()
		delete(wr.active, reviewID)
	}
}

func (wr *watchRegistry) poll(ctx context.Context, reviewID int64, repoPath string) {
	repo := git.New(repoPath)
	ticker := time.NewTicker(watchInterval)
	defer ticker.Stop()
	var lastRefs, lastTree string
	var refsReadAt time.Time
	var seeded bool
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			tree, err := repo.WorktreeFingerprint()
			if err != nil {
				continue // mid-rebase or unreadable: treat as no change
			}
			movedTree := tree != lastTree
			refs := lastRefs
			if refsDue(seeded, movedTree, time.Since(refsReadAt)) {
				read, err := repo.RefsFingerprint()
				if err != nil {
					continue // the tick is discarded whole, so the next one re-reads both
				}
				refs, refsReadAt = read, time.Now()
			}
			movedRefs := refs != lastRefs
			lastRefs, lastTree = refs, tree
			if !seeded {
				// Seed the baselines so connecting doesn't self-fire.
				seeded = true
				continue
			}
			// A ref move is the superset: it carries the diff the client would refetch anyway.
			if movedRefs {
				wr.hub.publish(reviewID, true, true)
			} else if movedTree {
				wr.hub.publish(reviewID, true, false)
			}
		}
	}
}

// refsDue reports whether this tick has to re-read the refs: at startup, whenever the worktree
// moved — a commit or a checkout shows in both, and the client needs to be told which it was —
// and otherwise only once a refsInterval has gone by.
func refsDue(seeded, movedTree bool, since time.Duration) bool {
	return !seeded || movedTree || since >= refsInterval
}
