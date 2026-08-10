import type { CommentSort } from "../commentSort";
import { COMMENT_SORTS, sortTimestamp } from "../commentSort";
import type { Comment } from "../types";
import { effectivePath } from "../types";
import { CommentPreview } from "./CommentPreview";

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
          {run.items.map((c) => (
            // a <button> can't nest in another, so the delete button is a sibling
            <div key={c.id} className="comment-nav-item">
              <button
                className={`comment-nav${c.resolved ? " comment-nav-resolved" : ""}${
                  c.anchorStatus === "outdated" ? " comment-nav-outdated" : ""
                }`}
                onClick={() => onJump(c.id)}
              >
                <CommentPreview comment={c} inline stamp={sortTimestamp(c, sort)} />
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
          ))}
        </div>
      ))}
    </div>
  );
}
