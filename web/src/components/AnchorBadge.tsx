import type { Comment } from "../types";

function origLabel(c: Comment): string {
  return c.endLine > c.startLine ? `L${c.startLine}–${c.endLine}` : `L${c.startLine}`;
}

// Flags a comment whose anchored code drifted: "moved" (relocated — the line
// label shows the current range, so this notes where it came from) or "outdated"
// (snippet gone or ambiguous at head). Nothing for current anchors. `compact`
// drops the "was …" detail for the dense comments panel.
export function AnchorBadge({ comment, compact = false }: { comment: Comment; compact?: boolean }) {
  if (comment.anchorStatus === "moved") {
    return (
      <>
        <span className="badge badge-moved" title={`moved from ${origLabel(comment)}`}>
          moved
        </span>
        {!compact && <span className="muted">was {origLabel(comment)}</span>}
      </>
    );
  }
  if (comment.anchorStatus === "outdated") {
    return (
      <span className="badge badge-outdated" title="the commented code no longer exists at head">
        outdated
      </span>
    );
  }
  return null;
}
