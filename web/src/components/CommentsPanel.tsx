import type { Comment } from "../types";
import { lineLabel } from "../types";
import { AnchorBadge } from "./AnchorBadge";

interface Props {
  comments: Comment[];
  onJump: (id: number) => void;
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
            <button
              key={c.id}
              className={`comment-nav${c.resolved ? " comment-nav-resolved" : ""}${
                c.anchorStatus === "outdated" ? " comment-nav-outdated" : ""
              }`}
              onClick={() => onJump(c.id)}
            >
              <div className="comment-meta">
                <span className="muted">#{c.id}</span>
                <span className={`badge badge-${c.type}`}>{c.type}</span>
                <span className="muted">{lineLabel(c)}</span>
                <AnchorBadge comment={c} compact />
                {c.resolved && <span className="muted">✓</span>}
                {(c.replies?.length ?? 0) > 0 && (
                  <span className="muted">💬 {c.replies.length}</span>
                )}
              </div>
              <div className="comment-preview">{c.body || <em className="muted">(empty)</em>}</div>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
