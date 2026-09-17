package api

import "testing"

// Wakeups coalesce, so what a client is told is decided by the flags alone. `refs` is a superset
// of `diff` (the client refetches branches and commits *and* the diff), `diff` of `meta` — so the
// broadest pending kind must win, and taking it must clear the narrower ones. Leaving one set
// sends a second ping, and a spurious `diff` is a whole diff refetch.
func TestTakeEventReportsTheBroadestPendingChange(t *testing.T) {
	h := newHub()
	sub := h.subscribe(1)

	want := func(got, expect, why string) {
		t.Helper()
		if got != expect {
			t.Errorf("takeEvent() = %q, want %q — %s", got, expect, why)
		}
	}

	want(sub.takeEvent(), "meta", "nothing published yet")

	h.publish(1, false, false)
	want(sub.takeEvent(), "meta", "a comment mutation moves no file")

	h.publish(1, true, false)
	want(sub.takeEvent(), "diff", "content moved")
	want(sub.takeEvent(), "meta", "a delivered diff must not repeat")

	h.publish(1, true, true)
	want(sub.takeEvent(), "refs", "a ref moved")
	want(sub.takeEvent(), "meta", "refs must clear the diff flag it subsumes")

	h.publish(1, true, false)
	h.publish(1, false, false)
	want(sub.takeEvent(), "diff", "a coalesced meta must not downgrade a pending diff")

	h.publish(1, true, true)
	h.publish(1, true, false)
	want(sub.takeEvent(), "refs", "a coalesced diff must not downgrade a pending refs")
}

// A subscriber that has gone away must not keep its slot, or the hub leaks a map entry per tab.
func TestPublishToAnUnsubscribedStreamIsANoOp(t *testing.T) {
	h := newHub()
	sub := h.subscribe(1)
	h.unsubscribe(1, sub)
	h.publish(1, true, true)
	if got := sub.takeEvent(); got != "meta" {
		t.Errorf("takeEvent() = %q, want meta — an unsubscribed stream should hear nothing", got)
	}
	if len(h.reviews) != 0 {
		t.Errorf("hub holds %d review(s) after the last unsubscribe, want 0", len(h.reviews))
	}
}
