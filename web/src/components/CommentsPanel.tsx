import type { Comment } from "../types";

interface Props {
  comments: Comment[];
  onJump: (id: number) => void;
}

function lineLabel(c: Comment) {
  return c.endLine > c.startLine ? `L${c.startLine}–${c.endLine}` : `L${c.startLine}`;
}

export function CommentsPanel({ comments, onJump }: Props) {
  const byFile = new Map<string, Comment[]>();
  for (const c of comments) {
    const arr = byFile.get(c.filePath) ?? [];
    arr.push(c);
    byFile.set(c.filePath, arr);
  }
  for (const arr of byFile.values()) arr.sort((a, b) => a.startLine - b.startLine);
  const files = [...byFile.keys()].sort();

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
            <button key={c.id} className="comment-nav" onClick={() => onJump(c.id)}>
              <div className="comment-meta">
                <span className={`badge badge-${c.type}`}>{c.type}</span>
                <span className="muted">{lineLabel(c)}</span>
              </div>
              <div className="comment-preview">{c.body || <em className="muted">(empty)</em>}</div>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
