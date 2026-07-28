import type { Comment } from "../types";
import { Chevron } from "./Chevron";

function origLabel(c: Comment): string {
  const lines = c.endLine > c.startLine ? `L${c.startLine}–${c.endLine}` : `L${c.startLine}`;
  // A move that followed a rename shows the original path too, since the comment
  // now lives under a different file.
  return c.currentFilePath ? `${c.filePath}:${lines}` : lines;
}

interface Props {
  comment: Comment;
  compact?: boolean;
  // When provided, the "outdated" badge becomes a toggle for the original-code
  // snippet; `expanded` reflects whether it's currently shown.
  onToggle?: () => void;
  expanded?: boolean;
}

export function AnchorBadge({ comment, compact = false, onToggle, expanded = false }: Props) {
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
    if (onToggle) {
      return (
        <button
          className="badge badge-outdated badge-toggle"
          onClick={onToggle}
          aria-expanded={expanded}
          title={expanded ? "Hide original code" : "Show original code"}
        >
          outdated
          <Chevron open={expanded} size={8} />
        </button>
      );
    }
    return (
      <span className="badge badge-outdated" title="the commented code no longer exists at head">
        outdated
      </span>
    );
  }
  return null;
}
