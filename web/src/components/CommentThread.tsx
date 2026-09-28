import { useEffect, useMemo, useState } from "react";
import { draftKey, dropDraft, getDraft } from "../drafts";
import type { Comment, CommentType, Reply } from "../types";
import { commentRef, effectivePath, lineLabel } from "../types";
import { langForPath } from "../highlight";
import { Chevron } from "./Chevron";
import { CommentComposer } from "./CommentComposer";
import { CopyButton } from "./CopyButton";
import { AnchorBadge } from "./AnchorBadge";
import { Markdown } from "./Markdown";
import { MetaTimestamps } from "./MetaTimestamps";
import { IconCheck, IconReply } from "./icons";

// A fence longer than any backtick run inside, so the snippet can't close the block early.
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

function SwapLabel({ shown, other }: { shown: string; other: string }) {
  return (
    <span className="swap-label" data-alt={other}>
      <span>{shown}</span>
    </span>
  );
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
  commentIds: Set<number>;
}

function ReplyItem({
  reply,
  path,
  commentId,
  onUpdate,
  onDelete,
  commentIds,
}: {
  reply: Reply;
  path: string;
  commentId: number;
  onUpdate: (body: string) => Promise<boolean>;
  onDelete: () => void;
  commentIds: Set<number>;
}) {
  const editKey = draftKey.editReply(reply.id);
  const [editing, setEditing] = useState(() => !!getDraft(editKey));

  function toggleEditing() {
    if (editing) dropDraft(editKey);
    setEditing(!editing);
  }

  return (
    <div className="reply" id={`reply-${reply.id}`}>
      <div className="reply-meta">
        <span className="muted meta-id">
          <IconReply />#{reply.id}
        </span>
        <MetaTimestamps
          author={reply.author}
          createdAt={reply.createdAt}
          updatedAt={reply.updatedAt}
        />
        <span className="spacer" />
        <button className="link" onClick={toggleEditing}>
          <SwapLabel shown={editing ? "close" : "edit"} other={editing ? "edit" : "close"} />
        </button>
        <button className="link danger" onClick={onDelete}>
          delete
        </button>
      </div>
      {editing ? (
        <CommentComposer
          hideType
          draft={{ key: editKey, target: { kind: "edit", path, commentId } }}
          initialBody={reply.body}
          submitLabel="Save"
          placeholder="Reply…"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            const ok = await onUpdate(body);
            if (ok) setEditing(false);
            return ok;
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
  const path = effectivePath(comment);
  const editKey = draftKey.editComment(comment.id);
  const replyKey = draftKey.reply(comment.id);
  const [editing, setEditing] = useState(() => !!getDraft(editKey));
  const [replying, setReplying] = useState(() => !!getDraft(replyKey));
  const [collapsed, setCollapsed] = useState(comment.resolved);
  const replies = comment.replies ?? [];

  // Keyed on the signal's nonce, so a manual re-collapse sticks until the next jump.
  useEffect(() => {
    if (expandSignal && expandSignal.id === comment.id) setCollapsed(false);
  }, [expandSignal, comment.id]);

  function closeComposersWithoutDrafts() {
    setEditing(!!getDraft(editKey));
    setReplying(!!getDraft(replyKey));
  }

  function toggleEditing() {
    if (editing) dropDraft(editKey);
    setEditing(!editing);
  }

  const outdated = comment.anchorStatus === "outdated";
  // The outdated badge toggles the captured snippet, hidden by default.
  const hasSnippet = outdated && comment.snippet.trim() !== "";
  const [snippetOpen, setSnippetOpen] = useState(false);
  const snippetMd = useMemo(
    () => snippetSource(comment.snippet, comment.filePath),
    [comment.snippet, comment.filePath]
  );

  function toggle() {
    setCollapsed((c) => {
      if (!c) closeComposersWithoutDrafts();
      return !c;
    });
  }

  function handleResolve() {
    const next = !comment.resolved;
    onResolve(comment.id, next);
    setCollapsed(next);
    if (next) closeComposersWithoutDrafts();
  }

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
        <CopyButton
          icon
          iconSize={12}
          className="btn-icon copy-icon"
          idleLabel="Copy reference"
          title="Copy a path:line reference to this comment"
          text={() => commentRef(comment)}
        />
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
        {comment.resolved && (
          <span className="badge badge-resolved">
            <IconCheck /> resolved
          </span>
        )}
        {collapsed && replies.length > 0 && (
          <span className="muted thread-reply-count">
            {replies.length} repl{replies.length === 1 ? "y" : "ies"}
          </span>
        )}
        <span className="spacer" />
        <button className="link" onClick={handleResolve}>
          <SwapLabel
            shown={comment.resolved ? "reopen" : "resolve"}
            other={comment.resolved ? "resolve" : "reopen"}
          />
        </button>
        {!collapsed && (
          <button className="link" onClick={toggleEditing}>
            <SwapLabel shown={editing ? "close" : "edit"} other={editing ? "edit" : "close"} />
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
              draft={{ key: editKey, target: { kind: "edit", path, commentId: comment.id } }}
              initialBody={comment.body}
              initialType={comment.type}
              submitLabel="Save"
              onCancel={() => setEditing(false)}
              onSubmit={async (body, type) => {
                const ok = await onUpdate(comment.id, body, type);
                if (ok) setEditing(false);
                return ok;
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
                  path={path}
                  commentId={comment.id}
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
                draft={{ key: replyKey, target: { kind: "reply", path, commentId: comment.id } }}
                submitLabel="Reply"
                placeholder="Reply…"
                onCancel={() => setReplying(false)}
                onSubmit={async (body) => {
                  const ok = await onAddReply(comment.id, body);
                  if (ok) setReplying(false);
                  return ok;
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
