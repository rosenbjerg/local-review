import { useEffect, useRef, type RefObject } from "react";

// Scroll-spy over the diff column: reports the file at the top of the viewport; suppress() pauses it around a programmatic scroll.
export function useActiveFile(
  rootRef: RefObject<HTMLElement | null>,
  onActive: (path: string) => void,
  // Changes when the scroll container (re)mounts; the ref alone is a stable object and wouldn't re-trigger the effect.
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
      const anchors = fileAnchors(root);
      if (anchors.length === 0) return;
      // The last anchor whose top is above a band below the top edge is active; anchors are in document order.
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

// Scanning children rather than a `[id^="file-"]` subtree query keeps this off the diff's own DOM, which grows with
// every file scrolled past — and this runs on every scroll frame.
function fileAnchors(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of root.children) {
    if (el instanceof HTMLElement && el.id.startsWith("file-")) out.push(el);
  }
  return out;
}
