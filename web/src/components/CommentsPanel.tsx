import type { Comment } from "../types";
import { lineLabel } from "../types";
import { AnchorBadge } from "./AnchorBadge";
import { CommentCount } from "./CommentCount";
import { Markdown } from "./Markdown";

interface Props {
  comments: Comment[];
  // Diff file paths in tree order, so this pane matches the explorer and diff.
  fileOrder: string[];
  onJump: (id: number) => void;
  onDelete: (id: number) => void;
}

export function CommentsPanel({ comments, fileOrder, onJump, onDelete }: Props) {
  const byFile = new Map<string, Comment[]>();
  for (const c of comments) {
    const arr = byFile.get(c.filePath) ?? [];
    arr.push(c);
    byFile.set(c.filePath, arr);
  }
  // Open threads on top (actionable), resolved below, each sub-group by line.
  for (const arr of byFile.values()) {
    arr.sort((a, b) => {
      if (!!a.resolved !== !!b.resolved) return a.resolved ? 1 : -1;
      return a.startLine - b.startLine;
    });
  }
  // Order files by diff position; files no longer in the diff trail at the end.
  const orderIndex = new Map(fileOrder.map((p, i) => [p, i]));
  const files = [...byFile.keys()].sort((a, b) => {
    const ia = orderIndex.get(a) ?? Infinity;
    const ib = orderIndex.get(b) ?? Infinity;
    return ia !== ib ? ia - ib : a.localeCompare(b);
  });

  return (
    <div className="comments-panel">
      <h2>
        Comments <span className="muted">({comments.length})</span>
      </h2>
      {comments.length === 0 && (
        <p className="muted">Click a line number in the diff to add a comment.</p>
      )}
      {files.map((file) => (
        <div key={file} className="comment-file-group">
          <div className="comment-file-name">{file}</div>
          {byFile.get(file)!.map((c) => (
            // Wrapper so the delete button is a sibling of the jump button —
            // a <button> can't nest in another.
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
          ))}
        </div>
      ))}
    </div>
  );
}
