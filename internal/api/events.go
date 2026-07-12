package api

import "sync"

// publish sends non-blocking, so a stalled client never blocks a mutation
// handler; a dropped ping is harmless because each one triggers a full refetch.
type hub struct {
	mu      sync.Mutex
	reviews map[int64]map[chan struct{}]struct{}
}

func newHub() *hub {
	return &hub{reviews: map[int64]map[chan struct{}]struct{}{}}
}

func (h *hub) subscribe(reviewID int64) chan struct{} {
	ch := make(chan struct{}, 1) // size 1: coalesce, never block the publisher
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.reviews[reviewID] == nil {
		h.reviews[reviewID] = map[chan struct{}]struct{}{}
	}
	h.reviews[reviewID][ch] = struct{}{}
	return ch
}

func (h *hub) unsubscribe(reviewID int64, ch chan struct{}) {
	h.mu.Lock()
	defer h.mu.Unlock()
	subs := h.reviews[reviewID]
	if subs == nil {
		return
	}
	delete(subs, ch)
	if len(subs) == 0 {
		delete(h.reviews, reviewID)
	}
}

func (h *hub) publish(reviewID int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.reviews[reviewID] {
		select {
		case ch <- struct{}{}:
		default: // a refresh is already pending for this client; coalesce
		}
	}
}
