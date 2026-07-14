package api

import (
	"context"
	"sync"
	"time"

	"local-review/internal/git"
)

// How often an actively-watched review's repo is polled for on-disk changes. The
// poller only runs while a review has at least one SSE subscriber, so idle reviews
// cost nothing.
const watchInterval = 1500 * time.Millisecond

// watchRegistry runs one filesystem poller per review that has live SSE
// subscribers, turning out-of-band changes (an agent editing files or committing)
// into a `diff` ping so the client refetches the diff, not just the review. It ref-counts
// subscribers so several tabs on one review share a single poller, and stops
// polling the instant a review's last tab disconnects.
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

// start registers one subscriber for reviewID and, if it's the first, spawns the
// poller for repoPath. Every start must be paired with a stop.
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

// stop drops one subscriber; the poller is cancelled once the last one leaves.
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
				continue // mid-rebase or transiently unreadable — treat as no change
			}
			if !haveBaseline {
				// Seed from the state already on screen so connecting doesn't self-fire.
				last, haveBaseline = fp, true
				continue
			}
			if fp != last {
				last = fp
				wr.hub.publish(reviewID, true) // on-disk change moved content: refetch the diff
			}
		}
	}
}
