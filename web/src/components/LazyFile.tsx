import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

interface Props {
  anchorId: string;
  label: string;
  estHeight: number;
  rootRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}

// Renders a lightweight placeholder until the file scrolls near the viewport,
// then mounts its diff and keeps it mounted. This bounds the DOM (and the
// per-file fetch + tokenization) to what the user actually looks at, so large
// change-sets stay responsive. The wrapper keeps the scroll anchor and an
// estimated height so the scrollbar and jump-to-file work before mount.
export function LazyFile({ anchorId, label, estHeight, rootRef, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { root: rootRef.current ?? null, rootMargin: "800px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, rootRef]);

  return (
    <div ref={ref} id={anchorId}>
      {shown ? (
        children
      ) : (
        <div className="file file-placeholder" style={{ height: estHeight }}>
          <div className="file-header">
            <span className="file-path">{label}</span>
            <span className="muted">…</span>
          </div>
        </div>
      )}
    </div>
  );
}
