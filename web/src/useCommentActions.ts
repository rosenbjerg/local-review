import { type Dispatch, type SetStateAction } from "react";
import { api } from "./api";
import type { CommentActions } from "./components/CommentThread";
import type { Comment, CommentType, Reply, Review } from "./types";

interface Params {
  review: Review | null;
  comments: Comment[];
  setComments: Dispatch<SetStateAction<Comment[]>>;
  setError: (msg: string | null) => void;
  // The anchor side for new comments, from the active diff scope: the working tree
  // or the git index (staged), else head_ref. The server captures the snippet from
  // that side so the stored text matches what the staleness check reads.
  worktree: boolean;
  indexed: boolean;
}

// The comment/reply CRUD handlers, as optimistic mutations over the comments
// state. Returns the CommentActions bag (for CommentThread) plus the add/delete
// handlers used directly by DiffView and CommentsPanel. Not memoized — the
// handlers must close over live `comments` each render.
export function useCommentActions({ review, comments, setComments, setError, worktree, indexed }: Params) {
  async function handleAddComment(args: {
    filePath: string;
    startLine: number;
    endLine: number;
    body: string;
    type: CommentType;
  }): Promise<boolean> {
    if (!review) return false;
    setError(null);
    try {
      const c = await api.addComment(review.id, { ...args, worktree, indexed });
      setComments((cs) => [...cs, c]);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function handleUpdate(id: number, body: string, type: CommentType): Promise<boolean> {
    const existing = comments.find((c) => c.id === id);
    if (!existing) return false;
    setError(null);
    try {
      const updated = await api.updateComment(id, {
        body,
        type,
        startLine: existing.startLine,
        endLine: existing.endLine,
      });
      setComments((cs) => cs.map((c) => (c.id === id ? updated : c)));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function handleDelete(id: number) {
    setError(null);
    try {
      await api.deleteComment(id);
      setComments((cs) => cs.filter((c) => c.id !== id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function updateCommentReplies(commentId: number, fn: (replies: Reply[]) => Reply[]) {
    setComments((cs) =>
      cs.map((c) => (c.id === commentId ? { ...c, replies: fn(c.replies ?? []) } : c))
    );
  }

  async function handleAddReply(commentId: number, body: string): Promise<boolean> {
    setError(null);
    try {
      const rep = await api.addReply(commentId, body);
      updateCommentReplies(commentId, (replies) => [...replies, rep]);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function handleUpdateReply(
    commentId: number,
    replyId: number,
    body: string
  ): Promise<boolean> {
    setError(null);
    try {
      const rep = await api.updateReply(replyId, body);
      updateCommentReplies(commentId, (replies) => replies.map((r) => (r.id === replyId ? rep : r)));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function handleDeleteReply(commentId: number, replyId: number) {
    setError(null);
    try {
      await api.deleteReply(replyId);
      updateCommentReplies(commentId, (replies) => replies.filter((r) => r.id !== replyId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleResolve(id: number, resolved: boolean) {
    setError(null);
    setComments((cs) => cs.map((c) => (c.id === id ? { ...c, resolved } : c)));
    try {
      await api.setCommentResolved(id, resolved);
    } catch (e) {
      setComments((cs) => cs.map((c) => (c.id === id ? { ...c, resolved: !resolved } : c)));
      setError((e as Error).message);
    }
  }

  const commentActions: CommentActions = {
    onUpdate: handleUpdate,
    onDelete: handleDelete,
    onAddReply: handleAddReply,
    onUpdateReply: handleUpdateReply,
    onDeleteReply: handleDeleteReply,
    onResolve: handleResolve,
  };

  return { commentActions, handleAddComment, handleDelete };
}
