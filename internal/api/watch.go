package api

import (
	"context"
	"sync"
	"time"

	"local-review/internal/git"
)

const watchInterval = 1500 * time.Millisecond

// watchRegistry runs one ref-counted filesystem poller per review with live SSE
// subscribers, turning out-of-band edits and commits into `diff` pings.
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
	var last string
	var haveBaseline bool
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			fp, err := repo.WorktreeFingerprint()
			if err != nil {
				continue // mid-rebase or unreadable: treat as no change
			}
			if !haveBaseline {
				// Seed the baseline so connecting doesn't self-fire.
				last, haveBaseline = fp, true
				continue
			}
			if fp != last {
				last = fp
				wr.hub.publish(reviewID, true)
			}
		}
	}
}
