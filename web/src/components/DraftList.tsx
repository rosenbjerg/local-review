import { type Draft, type DraftTarget, discardDraft, useDrafts } from "../drafts";
import { IconX } from "./icons";

function where(t: DraftTarget): string {
  switch (t.kind) {
    case "line":
      return t.startLine === t.endLine ? `L${t.startLine}` : `L${t.startLine}–${t.endLine}`;
    case "file":
      return "file comment";
    case "reply":
      return `reply to #${t.commentId}`;
    case "edit":
      return `edit of #${t.commentId}`;
  }
}

// File comments, then line comments top to bottom, then replies.
function rank(t: DraftTarget): [number, number, number] {
  switch (t.kind) {
    case "file":
      return [0, 0, 0];
    case "line":
      return [1, t.startLine, t.endLine];
    default:
      return [2, t.commentId, 0];
  }
}

function byFile(drafts: Draft[], fileOrder: string[]): { path: string; items: Draft[] }[] {
  const groups = new Map<string, Draft[]>();
  for (const d of drafts) {
    const at = groups.get(d.target.path);
    if (at) at.push(d);
    else groups.set(d.target.path, [d]);
  }
  const pos = (p: string) => {
    const i = fileOrder.indexOf(p);
    return i < 0 ? fileOrder.length : i;
  };
  return [...groups]
    .sort(([a], [b]) => pos(a) - pos(b) || a.localeCompare(b))
    .map(([path, items]) => ({
      path,
      items: items.sort((x, y) => {
        const a = rank(x.target);
        const b = rank(y.target);
        return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
      }),
    }));
}

export function DraftList({
  fileOrder,
  onJump,
}: {
  fileOrder: string[];
  onJump: (draft: Draft) => void;
}) {
  const drafts = [...useDrafts().values()].filter((d) => d.target.kind !== "edit");
  if (drafts.length === 0) return null;
  return (
    <section className="draft-list" aria-label="Unposted comments">
      <h2>
        Drafts <span className="muted">({drafts.length})</span>
      </h2>
      {byFile(drafts, fileOrder).map((group) => (
        <div key={group.path} className="comment-file-group">
          <div className="comment-file-name" title={group.path}>
            <span dir="ltr">{group.path}</span>
          </div>
          {group.items.map((d) => (
            <div key={d.key} className="comment-nav-item">
              <button
                className="comment-nav draft-nav"
                title="Not posted yet — click to go back to it"
                onClick={() => onJump(d)}
              >
                <div className="comment-meta">
                  {d.target.kind !== "reply" && (
                    <span className={`badge badge-${d.type}`}>{d.type}</span>
                  )}
                  <span className="muted">{where(d.target)}</span>
                </div>
                <div className="comment-preview draft-preview">
                  {d.body.replace(/\s+/g, " ").trim()}
                </div>
              </button>
              <button
                className="comment-nav-delete"
                title="Discard draft"
                aria-label="Discard draft"
                onClick={() => discardDraft(d.key)}
              >
                <IconX />
              </button>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
