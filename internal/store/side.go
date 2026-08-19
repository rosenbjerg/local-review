package store

// Side names which version of a file a comment or a reviewed mark was anchored
// to: the side its snippet was captured from, and the side its staleness is
// judged against. Reading the wrong side would never match and would read as
// outdated, so this value has to travel with every anchored record.
//
// It is deliberately one three-valued type rather than the pair of
// mutually-exclusive booleans the schema stores (see flags below). The pair made
// the impossible fourth state — "both" — representable in every signature that
// carried it, and it was validated in exactly one handler; a Side can't hold it
// at all.
type Side string

const (
	SideHead     Side = "head"     // the review's head_ref commit — the default
	SideWorktree Side = "worktree" // the on-disk working tree
	SideIndex    Side = "index"    // the git index (staged content)
)

// IsHead reports whether s names the head side. Deliberately written as "neither
// of the other two" rather than `s == SideHead`, so the zero value — a Comment
// built in Go without naming a side — reads as head, exactly like the `default:`
// arm of every switch that dispatches on a Side. An equality test looks
// equivalent and isn't: it sends an unset side down the *other* path, which is
// how the first draft of this type silently demoted every such comment from
// precise diff tracking to snippet matching.
func (s Side) IsHead() bool {
	return s != SideWorktree && s != SideIndex
}

// ParseSide reads a Side off the wire. An empty value is the head side, so a
// client that doesn't care about the anchor side needn't name one; anything else
// unrecognized is rejected rather than silently defaulted, or a typo ("staged")
// would anchor to head and read as a drifting comment later.
func ParseSide(s string) (Side, bool) {
	switch Side(s) {
	case "", SideHead:
		return SideHead, true
	case SideWorktree:
		return SideWorktree, true
	case SideIndex:
		return SideIndex, true
	}
	return SideHead, false
}

// The schema stores the side as two flags, which is the shape the columns
// shipped in; encoding lives here so Side is the only representation the rest of
// the program — and the wire — ever sees. Keeping the columns costs nothing and
// avoids migrating live review data for a purely internal cleanup.
func sideFromFlags(worktree, indexed bool) Side {
	// indexed is tested first, matching the read precedence every side switch
	// used before this type existed. A row with both set is impossible to write
	// now, but older rows predate the validation, so resolve rather than panic.
	switch {
	case indexed:
		return SideIndex
	case worktree:
		return SideWorktree
	default:
		return SideHead
	}
}

func (s Side) flags() (worktree, indexed bool) {
	return s == SideWorktree, s == SideIndex
}
