import { useState } from "react";
import type { Comment, CommentType, Reply } from "../types";
import { CommentComposer } from "./CommentComposer";

interface Props {
  comment: Comment;
  onUpdate: (id: number, body: string, type: CommentType) => Promise<boolean>;
  onDelete: (id: number) => Promise<void>;
  onAddReply: (commentId: number, body: string) => Promise<boolean>;
  onUpdateReply: (commentId: number, replyId: number, body: string) => Promise<boolean>;
  onDeleteReply: (commentId: number, replyId: number) => Promise<void>;
  onResolve: (id: number, resolved: boolean) => void;
}

function lineLabel(c: Comment) {
  return c.endLine > c.startLine ? `L${c.startLine}–${c.endLine}` : `L${c.startLine}`;
}

// A single reply within a thread. Replies carry no type or anchor — just body —
// so their editor is the composer with the type picker hidden.
function ReplyItem({
  reply,
  onUpdate,
  onDelete,
}: {
  reply: Reply;
  onUpdate: (body: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="reply" id={`reply-${reply.id}`}>
      <div className="reply-meta">
        <span className="muted">↳ #{reply.id}</span>
        <span className="spacer" />
        <button className="link" onClick={() => setEditing((e) => !e)}>
          {editing ? "close" : "edit"}
        </button>
        <button className="link danger" onClick={onDelete}>
          delete
        </button>
      </div>
      {editing ? (
        <CommentComposer
          hideType
          initialBody={reply.body}
          submitLabel="Save"
          placeholder="Reply…"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            if (await onUpdate(body)) setEditing(false);
          }}
        />
      ) : (
        <div className="reply-body">{reply.body}</div>
      )}
    </div>
  );
}

export function CommentThread({
  comment,
  onUpdate,
  onDelete,
  onAddReply,
  onUpdateReply,
  onDeleteReply,
  onResolve,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  const replies = comment.replies ?? [];

  return (
    <div className={`thread${comment.resolved ? " thread-resolved" : ""}`} id={`comment-${comment.id}`}>
      <div className="thread-meta">
        <span className="muted">#{comment.id}</span>
        <span className={`badge badge-${comment.type}`}>{comment.type}</span>
        <span className="muted">{lineLabel(comment)}</span>
        {comment.resolved && <span className="badge badge-resolved">✓ resolved</span>}
        <span className="spacer" />
        <button className="link" onClick={() => onResolve(comment.id, !comment.resolved)}>
          {comment.resolved ? "reopen" : "resolve"}
        </button>
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

      {replies.length > 0 && (
        <div className="thread-replies">
          {replies.map((r) => (
            <ReplyItem
              key={r.id}
              reply={r}
              onUpdate={(body) => onUpdateReply(comment.id, r.id, body)}
              onDelete={() => onDeleteReply(comment.id, r.id)}
            />
          ))}
        </div>
      )}

      {replying ? (
        <div className="thread-reply-composer">
          <CommentComposer
            hideType
            submitLabel="Reply"
            placeholder="Reply…"
            onCancel={() => setReplying(false)}
            onSubmit={async (body) => {
              if (await onAddReply(comment.id, body)) setReplying(false);
            }}
          />
        </div>
      ) : (
        <button className="link reply-add" onClick={() => setReplying(true)}>
          Reply
        </button>
      )}
    </div>
  );
}
