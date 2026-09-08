import { absoluteTime, relativeTime } from "../time";
import type { Comment } from "../types";
import { lineLabel } from "../types";
import { AnchorBadge } from "./AnchorBadge";
import { CommentCount } from "./CommentCount";
import { IconCheck } from "./icons";
import { Markdown } from "./Markdown";

// The compact read-only comment, shared by the pane and the #-ref popover; never linkifies
// nested refs, so a preview can't spawn another preview.
export function CommentPreview({
  comment,
  inline = false,
  stamp,
}: {
  comment: Comment;
  inline?: boolean;
  // The timestamp the pane is sorted on, so the order explains itself; empty under the file sort.
  stamp?: string;
}) {
  return (
    <>
      <div className="comment-meta">
        <span className="muted meta-id">#{comment.id}</span>
        <span className={`badge badge-${comment.type}`}>{comment.type}</span>
        <span className="muted">{lineLabel(comment)}</span>
        <AnchorBadge comment={comment} compact />
        {comment.resolved && <span className="muted meta-icon" title="resolved">
            <IconCheck />
          </span>}
        {(comment.replies?.length ?? 0) > 0 && <CommentCount n={comment.replies.length} label="reply" />}
        {stamp && (
          <span className="muted comment-nav-time" title={absoluteTime(stamp)}>
            {relativeTime(stamp)}
          </span>
        )}
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
