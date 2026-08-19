package api

import (
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
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

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpError(w, http.StatusInternalServerError, errString("streaming unsupported"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	sub := s.hub.subscribe(id)
	defer s.hub.unsubscribe(id, sub) // fires on every exit path — no orphaned channel

	// Poll the repo for out-of-band changes while this stream is open, so an agent's
	// edits/commits ping even when they don't hit a mutation handler. Ref-counted, so
	// multiple tabs share one poller; best-effort — skip if the repo can't be resolved.
	if repoPath, _, err := s.Store.ReviewRepoHead(id); err == nil && repoPath != "" {
		s.watch.start(id, repoPath)
		defer s.watch.stop(id)
	}

	if _, err := fmt.Fprint(w, ": connected\n\n"); err != nil {
		return
	}
	flusher.Flush()

	keepalive := time.NewTicker(25 * time.Second)
	defer keepalive.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-sub.signal:
			// diffPending set since the last read ⇒ file content moved: tell the
			// client to refetch the diff too, not just the review.
			event := "meta"
			if sub.diffPending.Swap(false) {
				event = "diff"
			}
			if _, err := fmt.Fprintf(w, "data: %s\n\n", event); err != nil {
				return
			}
			flusher.Flush()
		case <-keepalive.C:
			// Comment line (no onmessage): forces a write on an idle stream so a
			// dead connection errors out here.
			if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
