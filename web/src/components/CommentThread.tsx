import { useState } from "react";
import type { Comment, CommentType, Reply } from "../types";
import { lineLabel } from "../types";
import { CommentComposer } from "./CommentComposer";
import { AnchorBadge } from "./AnchorBadge";
import { Markdown } from "./Markdown";
import { MetaTimestamps } from "./MetaTimestamps";

// The thread's mutation callbacks, bundled so components that render threads
// forward one `actions` prop instead of six callbacks.
export interface CommentActions {
  onUpdate: (id: number, body: string, type: CommentType) => Promise<boolean>;
  onDelete: (id: number) => Promise<void>;
  onAddReply: (commentId: number, body: string) => Promise<boolean>;
  onUpdateReply: (commentId: number, replyId: number, body: string) => Promise<boolean>;
  onDeleteReply: (commentId: number, replyId: number) => Promise<void>;
  onResolve: (id: number, resolved: boolean) => void;
}

interface Props {
  comment: Comment;
  actions: CommentActions;
}

// Replies carry no type or anchor — just body — so their editor hides the
// composer's type picker.
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
        <span className="muted meta-id">↳ #{reply.id}</span>
        <MetaTimestamps
          author={reply.author}
          createdAt={reply.createdAt}
          updatedAt={reply.updatedAt}
        />
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
        <Markdown className="reply-body md-body" source={reply.body} />
      )}
    </div>
  );
}

export function CommentThread({ comment, actions }: Props) {
  const { onUpdate, onDelete, onAddReply, onUpdateReply, onDeleteReply, onResolve } = actions;
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  const replies = comment.replies ?? [];

  const outdated = comment.anchorStatus === "outdated";

  return (
    <div
      className={`thread${comment.resolved ? " thread-resolved" : ""}${outdated ? " thread-outdated" : ""}`}
      id={`comment-${comment.id}`}
    >
      <div className="thread-meta">
        <span className="muted meta-id">#{comment.id}</span>
        <span className={`badge badge-${comment.type}`}>{comment.type}</span>
        <span className="muted">{lineLabel(comment)}</span>
        <AnchorBadge comment={comment} />
        <MetaTimestamps
          author={comment.author}
          createdAt={comment.createdAt}
          updatedAt={comment.updatedAt}
        />
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
        <Markdown className="thread-body md-body" source={comment.body} />
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
