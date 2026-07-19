import type { Comment } from "../types";
import { effectivePath } from "../types";
import { CommentPreview } from "./CommentPreview";

interface Props {
  comments: Comment[];
  fileOrder: string[];
  onJump: (id: number) => void;
  onDelete: (id: number) => void;
}

export function CommentsPanel({ comments, fileOrder, onJump, onDelete }: Props) {
  const byFile = new Map<string, Comment[]>();
  for (const c of comments) {
    const p = effectivePath(c);
    const arr = byFile.get(p) ?? [];
    arr.push(c);
    byFile.set(p, arr);
  }
  for (const arr of byFile.values()) {
    arr.sort((a, b) => {
      if (!!a.resolved !== !!b.resolved) return a.resolved ? 1 : -1;
      return a.startLine - b.startLine;
    });
  }
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
            // a <button> can't nest in another, so the delete button is a sibling
            <div key={c.id} className="comment-nav-item">
              <button
                className={`comment-nav${c.resolved ? " comment-nav-resolved" : ""}${
                  c.anchorStatus === "outdated" ? " comment-nav-outdated" : ""
                }`}
                onClick={() => onJump(c.id)}
              >
                <CommentPreview comment={c} inline />
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
