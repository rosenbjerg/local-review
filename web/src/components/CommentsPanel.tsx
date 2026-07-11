import type { Comment } from "../types";
import { lineLabel } from "../types";
import { AnchorBadge } from "./AnchorBadge";
import { Markdown } from "./Markdown";

interface Props {
  comments: Comment[];
  // The diff's file paths in tree order (dirs first), so this pane lists files
  // in the same order as the explorer and the diff rather than alphabetically.
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
  // Within a file, keep open threads on top (actionable feedback stays
  // prominent) and resolved ones below, each sub-group ordered by line.
  for (const arr of byFile.values()) {
    arr.sort((a, b) => {
      if (!!a.resolved !== !!b.resolved) return a.resolved ? 1 : -1;
      return a.startLine - b.startLine;
    });
  }
  // Order files by their position in the diff (tree order); any file no longer
  // in the diff (a comment left on since-removed content) trails at the end,
  // alphabetically among themselves.
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
            // Positioned wrapper so the delete button can sit in the corner as a
            // sibling of the jump button — a <button> can't be nested in another.
            <div key={c.id} className="comment-nav-item">
              <button
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
