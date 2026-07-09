import type { Comment } from "../types";

function origLabel(c: Comment): string {
  return c.endLine > c.startLine ? `L${c.startLine}–${c.endLine}` : `L${c.startLine}`;
}

// AnchorBadge flags a comment whose anchored code drifted since it was written:
// "moved" (relocated to a new line — the line label already shows the current
// range, so this notes where it came from) or "outdated" (the snippet no longer
// exists at head, or is now ambiguous). Renders nothing for current anchors.
// `compact` drops the "was …" detail for the dense comments panel.
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
