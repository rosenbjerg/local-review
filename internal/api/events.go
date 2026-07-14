package api

import (
	"sync"
	"sync/atomic"
)

// A subscriber is one open SSE stream. `signal` is a coalescing wakeup (buffered
// size 1); `diffPending` rides alongside it so the wakeup can carry *what* changed
// without widening the channel. Any diff-level change since the last read sets it,
// and the handler clears it with Swap — so a dropped (coalesced) wakeup never loses
// the fact that the diff changed.
type subscriber struct {
	signal      chan struct{}
	diffPending atomic.Bool
}

// publish sends non-blocking, so a stalled client never blocks a mutation handler;
// a dropped wakeup is harmless because each one triggers a refetch and diffPending
// preserves whether the diff must be refetched too.
type hub struct {
	mu      sync.Mutex
	reviews map[int64]map[*subscriber]struct{}
}

func newHub() *hub {
	return &hub{reviews: map[int64]map[*subscriber]struct{}{}}
}

func (h *hub) subscribe(reviewID int64) *subscriber {
	sub := &subscriber{signal: make(chan struct{}, 1)} // size 1: coalesce, never block the publisher
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.reviews[reviewID] == nil {
		h.reviews[reviewID] = map[*subscriber]struct{}{}
	}
	h.reviews[reviewID][sub] = struct{}{}
	return sub
}

func (h *hub) unsubscribe(reviewID int64, sub *subscriber) {
	h.mu.Lock()
	defer h.mu.Unlock()
	subs := h.reviews[reviewID]
	if subs == nil {
		return
	}
	delete(subs, sub)
	if len(subs) == 0 {
		delete(h.reviews, reviewID)
	}
}

// publish wakes every subscriber of reviewID. diff=true marks the change as one
// that moved file content (a commit or on-disk edit), so the client refetches the
// diff and not just the review; diff=false is a metadata-only change (comment,
// reply, reviewed-file). diff "upgrades" a pending metadata wakeup since it's a
// superset, and the flag is never downgraded until the handler reads it.
func (h *hub) publish(reviewID int64, diff bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for sub := range h.reviews[reviewID] {
		if diff {
			sub.diffPending.Store(true)
		}
		select {
		case sub.signal <- struct{}{}:
		default: // a refresh is already pending for this client; coalesce
		}
	}
}
