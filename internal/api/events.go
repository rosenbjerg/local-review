package api

import (
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// subscriber is one open SSE stream: a coalescing wakeup channel plus the two pending
// flags, so a dropped (coalesced) wakeup never loses the fact that the diff or the refs moved.
type subscriber struct {
	signal      chan struct{}
	diffPending atomic.Bool
	refsPending atomic.Bool
}

// hub fans review changes out to subscribers; publish never blocks, so a stalled tab can't stall a handler.
type hub struct {
	mu      sync.Mutex
	reviews map[int64]map[*subscriber]struct{}
}

func newHub() *hub {
	return &hub{reviews: map[int64]map[*subscriber]struct{}{}}
}

func (h *hub) subscribe(reviewID int64) *subscriber {
	sub := &subscriber{signal: make(chan struct{}, 1)}
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

// publish wakes every subscriber of reviewID; diff=true means file content moved and refs=true
// that a ref moved. Each upgrades a pending wakeup of the narrower kind, being a superset of it.
func (h *hub) publish(reviewID int64, diff, refs bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for sub := range h.reviews[reviewID] {
		if diff {
			sub.diffPending.Store(true)
		}
		if refs {
			sub.refsPending.Store(true)
		}
		select {
		case sub.signal <- struct{}{}:
		default: // a refresh is already pending for this client; coalesce
		}
	}
}

// takeEvent names the ping to send and clears what it reports. Both flags clear on every call,
// whichever wins: a `refs` that left `diff` pending would ping again, and a `diff` ping costs the
// client a whole diff refetch.
func (sub *subscriber) takeEvent() string {
	diffMoved := sub.diffPending.Swap(false)
	refsMoved := sub.refsPending.Swap(false)
	switch {
	case refsMoved:
		return "refs"
	case diffMoved:
		return "diff"
	}
	return "meta"
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		return errString("streaming unsupported")
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	sub := s.hub.subscribe(id)
	defer s.hub.unsubscribe(id, sub)

	// Poll for out-of-band edits and commits while the stream is open; ref-counted across tabs, best-effort.
	if repo, _, err := s.reviewRepo(id); err == nil && repo.Path != "" {
		s.watch.start(id, repo.Path)
		defer s.watch.stop(id)
	}

	if _, err := fmt.Fprint(w, ": connected\n\n"); err != nil {
		return nil
	}
	flusher.Flush()

	keepalive := time.NewTicker(25 * time.Second)
	defer keepalive.Stop()

	// Past the first write the status is already on the wire, so every exit below is a
	// plain nil — an error return here would try to write a second header.
	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-sub.signal:
			if _, err := fmt.Fprintf(w, "data: %s\n\n", sub.takeEvent()); err != nil {
				return nil
			}
			flusher.Flush()
		case <-keepalive.C:
			// A comment line forces a write on an idle stream, so a dead connection errors out here.
			if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil {
				return nil
			}
			flusher.Flush()
		}
	}
}
