package store

// Side names the file version an anchor was captured from and is judged against — one
// three-valued type, so the schema's impossible "both flags" state isn't representable.
type Side string

const (
	SideHead     Side = "head"     // the review's head_ref commit — the default
	SideWorktree Side = "worktree" // the on-disk working tree
	SideIndex    Side = "index"    // the git index (staged content)
)

// IsHead reports whether s names the head side. Written as "neither other side", not
// `s == SideHead`, so the zero value (a Side never set) reads as head like the default arm.
func (s Side) IsHead() bool {
	return s != SideWorktree && s != SideIndex
}

// ParseSide reads a Side off the wire: empty is head, anything else unrecognized is
// rejected rather than defaulted, or a typo would anchor to head and later read as drifted.
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

// sideFromFlags decodes the schema's two flag columns; it and flags are the only places that shape exists.
func sideFromFlags(worktree, indexed bool) Side {
	// indexed wins: older rows may predate the both-set validation, so resolve rather than panic.
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
