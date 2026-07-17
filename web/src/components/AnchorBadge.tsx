import type { Comment } from "../types";

function origLabel(c: Comment): string {
  const lines = c.endLine > c.startLine ? `L${c.startLine}–${c.endLine}` : `L${c.startLine}`;
  // A move that followed a rename shows the original path too, since the comment
  // now lives under a different file.
  return c.currentFilePath ? `${c.filePath}:${lines}` : lines;
}

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
