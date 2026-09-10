package git

// MapOldLine maps a 1-based old-side line to its new-side line; alive=false means it was deleted or modified.
func MapOldLine(hunks []Hunk, old int) (newLine int, alive bool) {
	offset := 0
	for _, h := range hunks {
		oldStart, newStart := parseHunkHeader(h.Header)
		if old < oldStart {
			return old + offset, true // unchanged region before this hunk
		}
		oldLn, newLn := oldStart, newStart
		for _, l := range h.Lines {
			switch l.Kind {
			case LineContext:
				if oldLn == old {
					return newLn, true
				}
				oldLn++
				newLn++
			case LineDel:
				if oldLn == old {
					return 0, false
				}
				oldLn++
			case LineAdd:
				newLn++
			}
		}
		offset = newLn - oldLn
	}
	return old + offset, true // unchanged region after the last hunk
}

// HunksOldExtent returns the highest old-side line the hunks touch; beyond it MapOldLine is a constant offset.
func HunksOldExtent(hunks []Hunk) int {
	max := 0
	for _, h := range hunks {
		oldStart, _ := parseHunkHeader(h.Header)
		old := oldStart
		for _, l := range h.Lines {
			if l.Kind == LineContext || l.Kind == LineDel {
				old++
			}
		}
		if last := old - 1; last > max { // old is one past the last covered line
			max = last
		}
	}
	return max
}
