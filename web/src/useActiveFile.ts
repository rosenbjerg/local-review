import { useEffect, useRef, type RefObject } from "react";

// Scroll-spy over the diff column: reports the file currently at the top of the
// viewport as you scroll, so the tree can highlight what you're actually looking
// at (not just the last-clicked file). Every file card keeps a stable
// `#file-<path>` wrapper in the DOM, so it reads them live rather than tracking a
// list. Returns suppress(), which callers invoke around a programmatic scroll so
// the spy doesn't flicker through intermediate files before it lands.
export function useActiveFile(
  rootRef: RefObject<HTMLElement | null>,
  onActive: (path: string) => void,
  // Changes when the scroll container mounts/remounts (e.g. a review opens), so
  // the listener attaches once the element actually exists — the ref alone is a
  // stable object and wouldn't re-trigger the effect.
  ready: unknown
) {
  const onActiveRef = useRef(onActive);
  useEffect(() => {
    onActiveRef.current = onActive; // keep latest without re-subscribing the scroll listener
  });
  const suppressUntil = useRef(0);
  const lastActive = useRef<string | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let raf = 0;
    const compute = () => {
      raf = 0;
      if (performance.now() < suppressUntil.current) return;
      const anchors = root.querySelectorAll<HTMLElement>('[id^="file-"]');
      if (anchors.length === 0) return;
      // A thin band below the top is the "you're reading this" line; the last file
      // whose top is above it is the active one. Anchors are in document (top-down)
      // order, so stop at the first one below the line.
      const line = root.getBoundingClientRect().top + 80;
      let active = anchors[0].id.slice(5); // strip "file-"
      for (const el of anchors) {
        if (el.getBoundingClientRect().top <= line) active = el.id.slice(5);
        else break;
      }
      if (active !== lastActive.current) {
        lastActive.current = active;
        onActiveRef.current(active);
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [rootRef, ready]);

  return {
    suppress: (ms = 600) => {
      suppressUntil.current = performance.now() + ms;
    },
  };
}
