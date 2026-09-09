import { useLayoutEffect, useState, type RefObject } from "react";

export interface AnchoredPos {
  top?: number;
  bottom?: number;
  left: number;
  minWidth: number;
  maxHeight: number;
}

const MARGIN = 12;
const FLIP_BELOW = 160;

// A dropdown positioned against the viewport instead of its anchor. Inside a scrolling container —
// the settings dialog's body — an absolutely positioned list is clipped by the scroller, and the
// modal's entrance animation leaves no transform behind to make `fixed` mean anything else. The list
// is sized to the room actually there, so it never has to be scrolled to before it can be read.
export function useAnchoredList(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  list: RefObject<HTMLElement | null>,
  close: () => void
): AnchoredPos | null {
  const [pos, setPos] = useState<AnchoredPos | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const el = anchor.current;
    if (el) {
      const r = el.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - MARGIN;
      const above = r.top - MARGIN;
      // minWidth, not width: a row can outgrow its anchor, and the list's own max-width still holds.
      setPos(
        below < FLIP_BELOW && above > below
          ? { bottom: window.innerHeight - r.top + 2, left: r.left, minWidth: r.width, maxHeight: above }
          : { top: r.bottom + 2, left: r.left, minWidth: r.width, maxHeight: below }
      );
    }
    // Dismissed rather than followed: the anchor moves under any scroller between here and the page.
    // The list's own scrolling is exempt, or following the keyboard selection would close it.
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && list.current?.contains(e.target)) return;
      close();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open, anchor, list, close]);

  return pos;
}
