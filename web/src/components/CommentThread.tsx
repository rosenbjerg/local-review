import { useEffect, useMemo, useState } from "react";
import type { Comment, CommentType, Reply } from "../types";
import { lineLabel } from "../types";
import { langForPath } from "../highlight";
import { Chevron } from "./Chevron";
import { CommentComposer } from "./CommentComposer";
import { AnchorBadge } from "./AnchorBadge";
import { Markdown } from "./Markdown";
import { MetaTimestamps } from "./MetaTimestamps";

// Wrap the captured snippet in a fenced code block for <Markdown>, tagged with the
// file's language and using a fence longer than any backtick run inside it so the
// snippet can't close the block early (mirrors the export's fenceFor).
function snippetSource(snippet: string, path: string): string {
  const lang = langForPath(path) ?? "";
  let maxRun = 0;
  let run = 0;
  for (const ch of snippet) {
    if (ch === "`") {
      run++;
      if (run > maxRun) maxRun = run;
    } else {
      run = 0;
    }
  }
  const fence = "`".repeat(Math.max(3, maxRun + 1));
  return `${fence}${lang}\n${snippet}\n${fence}`;
}

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
  // Bumped by a jump-to; expands this thread when it targets this comment.
  expandSignal?: { id: number; n: number } | null;
  // The review's comment ids, so `#<id>` references in bodies/replies linkify.
  commentIds: Set<number>;
}

function ReplyItem({
  reply,
  onUpdate,
  onDelete,
  commentIds,
}: {
  reply: Reply;
  onUpdate: (body: string) => Promise<boolean>;
  onDelete: () => void;
  commentIds: Set<number>;
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
        <Markdown className="reply-body md-body" source={reply.body} commentIds={commentIds} />
      )}
    </div>
  );
}

export function CommentThread({ comment, actions, expandSignal, commentIds }: Props) {
  const { onUpdate, onDelete, onAddReply, onUpdateReply, onDeleteReply, onResolve } = actions;
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  // Resolved threads start collapsed — they're done and dimmed, so tuck them away.
  const [collapsed, setCollapsed] = useState(comment.resolved);
  const replies = comment.replies ?? [];

  // Expand when jumped to (e.g. n/p navigation or the comments panel), so a
  // collapsed thread reveals its body. Keyed on the signal's nonce, so a manual
  // re-collapse afterwards sticks until the next jump.
  useEffect(() => {
    if (expandSignal && expandSignal.id === comment.id) setCollapsed(false);
  }, [expandSignal, comment.id]);

  const outdated = comment.anchorStatus === "outdated";
  // For an outdated comment the anchored code is gone from head, so the captured
  // snippet ("original code") can be revealed by clicking the outdated badge —
  // hidden by default.
  const hasSnippet = outdated && comment.snippet.trim() !== "";
  const [snippetOpen, setSnippetOpen] = useState(false);
  const snippetMd = useMemo(
    () => snippetSource(comment.snippet, comment.filePath),
    [comment.snippet, comment.filePath]
  );

  function toggle() {
    setCollapsed((c) => {
      if (!c) {
        // Collapsing: drop any open composer so it can't linger hidden.
        setEditing(false);
        setReplying(false);
      }
      return !c;
    });
  }

  function handleResolve() {
    const next = !comment.resolved;
    onResolve(comment.id, next);
    // Resolving tucks the thread away; reopening brings it back.
    setCollapsed(next);
    if (next) {
      setEditing(false);
      setReplying(false);
    }
  }

  // Markdown flattened to one line for the collapsed preview.
  const preview = comment.body.replace(/\s+/g, " ").trim();

  return (
    <div
      className={`thread${comment.resolved ? " thread-resolved" : ""}${outdated ? " thread-outdated" : ""}`}
      id={`comment-${comment.id}`}
    >
      <div className="thread-meta">
        <button
          className="thread-toggle"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand thread" : "Collapse thread"}
          title={collapsed ? "Expand thread" : "Collapse thread"}
        >
          <Chevron open={!collapsed} size={10} />
        </button>
        <span className="muted meta-id">#{comment.id}</span>
        <span className={`badge badge-${comment.type}`}>{comment.type}</span>
        <span className="muted">{lineLabel(comment)}</span>
        <AnchorBadge
          comment={comment}
          onToggle={hasSnippet ? () => setSnippetOpen((o) => !o) : undefined}
          expanded={snippetOpen}
        />
        <MetaTimestamps
          author={comment.author}
          createdAt={comment.createdAt}
          updatedAt={comment.updatedAt}
        />
        {comment.resolved && <span className="badge badge-resolved">✓ resolved</span>}
        {collapsed && replies.length > 0 && (
          <span className="muted thread-reply-count">
            {replies.length} repl{replies.length === 1 ? "y" : "ies"}
          </span>
        )}
        <span className="spacer" />
        <button className="link" onClick={handleResolve}>
          {comment.resolved ? "reopen" : "resolve"}
        </button>
        {!collapsed && (
          <button className="link" onClick={() => setEditing((e) => !e)}>
            {editing ? "close" : "edit"}
          </button>
        )}
        <button className="link danger" onClick={() => onDelete(comment.id)}>
          delete
        </button>
      </div>

      {hasSnippet && snippetOpen && (
        <div className="thread-snippet">
          <div className="thread-snippet-label">original code</div>
          <Markdown className="md-body" source={snippetMd} softBreaks={false} />
        </div>
      )}

      {collapsed ? (
        <button className="thread-collapsed" onClick={toggle} title="Expand thread">
          {preview || <span className="muted">(no description)</span>}
        </button>
      ) : (
        <>
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
            <Markdown className="thread-body md-body" source={comment.body} commentIds={commentIds} />
          )}

          {replies.length > 0 && (
            <div className="thread-replies">
              {replies.map((r) => (
                <ReplyItem
                  key={r.id}
                  reply={r}
                  onUpdate={(body) => onUpdateReply(comment.id, r.id, body)}
                  onDelete={() => onDeleteReply(comment.id, r.id)}
                  commentIds={commentIds}
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
        </>
      )}
    </div>
  );
}
