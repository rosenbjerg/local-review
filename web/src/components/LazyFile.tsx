import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

interface Props {
  anchorId: string;
  label: string;
  estHeight: number;
  rootRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}

// Mounts once scrolled near, then stays mounted (`shown` never resets) —
// unmounting on scroll-away would re-fetch and re-tokenize each pass. The
// placeholder's estimated height keeps scroll and jump-to-file stable pre-mount.
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
            <span className="file-path" title={label}>
              {label}
            </span>
            <span className="muted">…</span>
          </div>
        </div>
      )}
    </div>
  );
}
