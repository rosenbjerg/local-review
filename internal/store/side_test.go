package store

import "testing"

// The zero value of Side is "", not SideHead — a Comment built in Go without
// naming a side. Every dispatch on a Side has to treat that as head, because the
// alternative is a comment silently anchored to a side it was never written
// against. IsHead is the one predicate that decides it, so pin it here rather
// than in each caller.
func TestSideZeroValueIsHead(t *testing.T) {
	var unset Side
	if !unset.IsHead() {
		t.Error("the zero Side must read as head")
	}
	if !SideHead.IsHead() {
		t.Error("SideHead must read as head")
	}
	for _, s := range []Side{SideWorktree, SideIndex} {
		if s.IsHead() {
			t.Errorf("%q must not read as head", s)
		}
	}
}

func TestParseSide(t *testing.T) {
	ok := map[string]Side{
		"":         SideHead, // omitted — an agent commenting on committed code
		"head":     SideHead,
		"worktree": SideWorktree,
		"index":    SideIndex,
	}
	for in, want := range ok {
		got, valid := ParseSide(in)
		if !valid || got != want {
			t.Errorf("ParseSide(%q) = %q, %v; want %q, true", in, got, valid, want)
		}
	}
	// A plausible typo must be refused, not defaulted: silently anchoring to head
	// makes the comment read as drifted the moment the staged content differs.
	for _, in := range []string{"staged", "HEAD", "worktree ", "index=true", "true"} {
		if _, valid := ParseSide(in); valid {
			t.Errorf("ParseSide(%q) accepted an unknown side", in)
		}
	}
}

// The schema stores a Side as two flags, so every side must survive the trip out
// to those columns and back — for a comment and for a reviewed mark alike.
func TestSideRoundTripsThroughColumns(t *testing.T) {
	s := openTemp(t)
	rev := addReview(t, s)

	for _, side := range []Side{SideHead, SideWorktree, SideIndex} {
		c, err := s.AddComment(Comment{
			ReviewID: rev.ID, FilePath: "a.go", StartLine: 1, EndLine: 1,
			Type: CommentNit, Body: "x", Side: side,
		})
		if err != nil {
			t.Fatalf("AddComment(%q): %v", side, err)
		}
		if c.Side != side {
			t.Errorf("comment side round-trip = %q, want %q", c.Side, side)
		}

		path := "f-" + string(side) + ".go"
		if err := s.SetFilesReviewed(rev.ID, []FileReviewMark{{Path: path, ContentHash: "h"}}, true, side); err != nil {
			t.Fatalf("SetFilesReviewed(%q): %v", side, err)
		}
		full, err := s.ListReviewedFilesFull(rev.ID)
		if err != nil {
			t.Fatal(err)
		}
		var found bool
		for _, f := range full {
			if f.Path == path {
				found = true
				if f.Side != side {
					t.Errorf("reviewed-mark side round-trip = %q, want %q", f.Side, side)
				}
			}
		}
		if !found {
			t.Errorf("reviewed mark for %q not stored", path)
		}
	}
}

// Rows predating the mutual-exclusion check could hold both flags — a state a
// Side can't represent. Decoding must resolve it the way every side switch used
// to (index wins), not produce an empty or invented value.
func TestSideFromFlagsResolvesLegacyBothSet(t *testing.T) {
	cases := []struct {
		worktree, indexed bool
		want              Side
	}{
		{false, false, SideHead},
		{true, false, SideWorktree},
		{false, true, SideIndex},
		{true, true, SideIndex}, // impossible to write now; index took precedence before
	}
	for _, c := range cases {
		if got := sideFromFlags(c.worktree, c.indexed); got != c.want {
			t.Errorf("sideFromFlags(%v, %v) = %q, want %q", c.worktree, c.indexed, got, c.want)
		}
	}
	// And the encoding is the inverse for every representable side.
	for _, side := range []Side{SideHead, SideWorktree, SideIndex} {
		if got := sideFromFlags(side.flags()); got != side {
			t.Errorf("flags→side round-trip for %q gave %q", side, got)
		}
	}
}
