import { useLayoutEffect, useRef, useState } from "react";
import type { Comment } from "../types";
import type { RefHover } from "../useCommentRefs";
import { CommentPreview } from "./CommentPreview";

// A non-interactive (pointer-events: none) preview of the referenced comment,
// shown on hover/focus of a `#<id>` link and positioned from the anchor's rect:
// below by default, flipped above near the viewport bottom, and clamped in.
export function CommentRefPopover({ hovered, comments }: { hovered: RefHover | null; comments: Comment[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const comment = hovered ? comments.find((c) => c.id === hovered.id) : null;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !hovered) return;
    const { rect } = hovered;
    const margin = 8;
    const pw = el.offsetWidth;
    const ph = el.offsetHeight;
    let top = rect.bottom + 6;
    if (top + ph > window.innerHeight - margin) top = Math.max(margin, rect.top - ph - 6);
    let left = Math.min(rect.left, window.innerWidth - pw - margin);
    left = Math.max(margin, left);
    setPos({ top, left });
  }, [hovered, comment]);

  if (!hovered || !comment) return null;
  return (
    <div
      ref={ref}
      className="comment-ref-popover"
      role="tooltip"
      // Off-screen until measured, so the first frame doesn't flash at a stale spot.
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
    >
      <CommentPreview comment={comment} />
    </div>
  );
}
