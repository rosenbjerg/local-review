import { useState } from "react";
import type { Comment, CommentType } from "../types";
import { CommentComposer } from "./CommentComposer";

interface Props {
  comment: Comment;
  onUpdate: (id: number, body: string, type: CommentType) => Promise<boolean>;
  onDelete: (id: number) => Promise<void>;
}

function lineLabel(c: Comment) {
  return c.endLine > c.startLine ? `L${c.startLine}–${c.endLine}` : `L${c.startLine}`;
}

export function CommentThread({ comment, onUpdate, onDelete }: Props) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="thread" id={`comment-${comment.id}`}>
      <div className="thread-meta">
        <span className="muted">#{comment.id}</span>
        <span className={`badge badge-${comment.type}`}>{comment.type}</span>
        <span className="muted">{lineLabel(comment)}</span>
        <span className="spacer" />
        <button className="link" onClick={() => setEditing((e) => !e)}>
          {editing ? "close" : "edit"}
        </button>
        <button className="link danger" onClick={() => onDelete(comment.id)}>
          delete
        </button>
      </div>
      {editing ? (
        <CommentComposer
          initialBody={comment.body}
          initialType={comment.type}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={async (body, type) => {
            if (await onUpdate(comment.id, body, type)) setEditing(false);
          }}
        />
      ) : (
        <div className="thread-body">{comment.body}</div>
      )}
    </div>
  );
}
