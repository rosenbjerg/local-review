import type { Comment } from "../types";
import { lineLabel } from "../types";
import { AnchorBadge } from "./AnchorBadge";
import { CommentCount } from "./CommentCount";
import { Markdown } from "./Markdown";

// The compact read-only view of a comment — id, type, line, anchor state, reply
// count, and a clamped body. Shared by the comments panel (inline body) and the
// #-reference hover popover (block body). Never linkifies nested refs, so a preview
// can't spawn another preview.
export function CommentPreview({ comment, inline = false }: { comment: Comment; inline?: boolean }) {
  return (
    <>
      <div className="comment-meta">
        <span className="muted meta-id">#{comment.id}</span>
        <span className={`badge badge-${comment.type}`}>{comment.type}</span>
        <span className="muted">{lineLabel(comment)}</span>
        <AnchorBadge comment={comment} compact />
        {comment.resolved && <span className="muted">✓</span>}
        {(comment.replies?.length ?? 0) > 0 && <CommentCount n={comment.replies.length} label="reply" />}
      </div>
      {comment.body ? (
        <Markdown className="comment-preview md-body" source={comment.body} inline={inline} />
      ) : (
        <div className="comment-preview">
          <em className="muted">(empty)</em>
        </div>
      )}
    </>
  );
}
