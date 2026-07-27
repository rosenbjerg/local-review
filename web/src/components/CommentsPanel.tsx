import type { CommentSort } from "../commentSort";
import { COMMENT_SORTS, sortTimestamp } from "../commentSort";
import { absoluteTime, relativeTime } from "../time";
import type { Comment } from "../types";
import { effectivePath, lineLabel } from "../types";
import { AnchorBadge } from "./AnchorBadge";
import { CommentCount } from "./CommentCount";
import { Markdown } from "./Markdown";

interface Props {
  comments: Comment[];
  sort: CommentSort;
  onSortChange: (sort: CommentSort) => void;
  onJump: (id: number) => void;
  onDelete: (id: number) => void;
}

// `comments` arrives sorted (see commentSort.sortComments), which keeps each
// file's comments contiguous — so the groups are just runs of one path.
function fileRuns(comments: Comment[]): { path: string; items: Comment[] }[] {
  const runs: { path: string; items: Comment[] }[] = [];
  for (const c of comments) {
    const path = effectivePath(c);
    const last = runs[runs.length - 1];
    if (last && last.path === path) last.items.push(c);
    else runs.push({ path, items: [c] });
  }
  return runs;
}

export function CommentsPanel({ comments, sort, onSortChange, onJump, onDelete }: Props) {
  return (
    <div className="comments-panel">
      <div className="comments-panel-header">
        <h2>
          Comments <span className="muted">({comments.length})</span>
        </h2>
        {comments.length > 0 && (
          <select
            aria-label="Sort comments"
            value={sort}
            onChange={(e) => onSortChange(e.target.value as CommentSort)}
          >
            {COMMENT_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {comments.length === 0 && (
        <p className="muted">Click a line number in the diff to add a comment.</p>
      )}
      {fileRuns(comments).map((run) => (
        <div key={run.path} className="comment-file-group">
          <div className="comment-file-name">{run.path}</div>
          {run.items.map((c) => {
            const stamp = sortTimestamp(c, sort);
            return (
              // a <button> can't nest in another, so the delete button is a sibling
              <div key={c.id} className="comment-nav-item">
                <button
                  className={`comment-nav${c.resolved ? " comment-nav-resolved" : ""}${
                    c.anchorStatus === "outdated" ? " comment-nav-outdated" : ""
                  }`}
                  onClick={() => onJump(c.id)}
                >
                  <div className="comment-meta">
                    <span className="muted meta-id">#{c.id}</span>
                    <span className={`badge badge-${c.type}`}>{c.type}</span>
                    <span className="muted">{lineLabel(c)}</span>
                    <AnchorBadge comment={c} compact />
                    {c.resolved && <span className="muted">✓</span>}
                    {(c.replies?.length ?? 0) > 0 && (
                      <CommentCount n={c.replies.length} label="reply" />
                    )}
                    {stamp && (
                      <span className="muted comment-nav-time" title={absoluteTime(stamp)}>
                        {relativeTime(stamp)}
                      </span>
                    )}
                  </div>
                  {c.body ? (
                    <Markdown className="comment-preview md-body" source={c.body} inline />
                  ) : (
                    <div className="comment-preview">
                      <em className="muted">(empty)</em>
                    </div>
                  )}
                </button>
                <button
                  className="comment-nav-delete"
                  title="Delete comment"
                  aria-label="Delete comment"
                  onClick={() => onDelete(c.id)}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
