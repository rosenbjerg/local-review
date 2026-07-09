package api

import "sync"

// hub fans review-change pings out to connected SSE subscribers, keyed by review
// id. Each subscriber gets a buffered channel; publish does a non-blocking send,
// so a stalled or dead client can never block a mutation handler. A dropped ping
// is harmless: every ping makes the client refetch full canonical state, so at
// most one refresh is ever owed per client (the size-1 buffer coalesces bursts).
type hub struct {
	mu      sync.Mutex
	reviews map[int64]map[chan struct{}]struct{}
}

func newHub() *hub {
	return &hub{reviews: map[int64]map[chan struct{}]struct{}{}}
}

// subscribe registers a new subscriber for a review and returns its channel.
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

// unsubscribe removes a subscriber and prunes the review entry once its last
// subscriber disconnects, so closed tabs leave nothing behind.
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

// publish notifies every subscriber of a review that its state changed.
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
