import { useMemo, type Dispatch, type SetStateAction } from "react";
import { api } from "./api";
import type { CommentActions } from "./components/CommentThread";
import type { Comment, CommentType, Reply, Review, Side } from "./types";

interface Params {
  review: Review | null;
  setComments: Dispatch<SetStateAction<Comment[]>>;
  setError: (msg: string | null) => void;
  // The anchor side for new comments; the server captures the snippet from it.
  side: Side;
}

// Comment/reply CRUD as optimistic mutations over the comments state.
export function useCommentActions({ review, setComments, setError, side }: Params) {
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
      const c = await api.addComment(review.id, { ...args, side });
      setComments((cs) => [...cs, c]);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  // The thread actions live inside one memo, which is doing three jobs. It reaches every
  // DiffView as `actions`, compared by identity — a fresh object each render silently
  // disabled that memo. Its deps are the two setters, which never change, so the object
  // holds for the life of the review. And a `use*` function that calls no hook of its own
  // is not a hook the React Compiler will compile: this call is what opts the file in.
  // Nothing here reads `review` or `side` — only handleAddComment above does.
  const commentActions: CommentActions = useMemo(() => {
    function updateReplies(commentId: number, fn: (replies: Reply[]) => Reply[]) {
      setComments((cs) =>
        cs.map((c) => (c.id === commentId ? { ...c, replies: fn(c.replies ?? []) } : c))
      );
    }

    return {
      async onUpdate(id: number, body: string, type: CommentType): Promise<boolean> {
        setError(null);
        try {
          const updated = await api.updateComment(id, { body, type });
          setComments((cs) => cs.map((c) => (c.id === id ? updated : c)));
          return true;
        } catch (e) {
          setError((e as Error).message);
          return false;
        }
      },

      async onDelete(id: number) {
        setError(null);
        try {
          await api.deleteComment(id);
          setComments((cs) => cs.filter((c) => c.id !== id));
        } catch (e) {
          setError((e as Error).message);
        }
      },

      async onAddReply(commentId: number, body: string): Promise<boolean> {
        setError(null);
        try {
          const rep = await api.addReply(commentId, body);
          updateReplies(commentId, (replies) => [...replies, rep]);
          return true;
        } catch (e) {
          setError((e as Error).message);
          return false;
        }
      },

      async onUpdateReply(commentId: number, replyId: number, body: string): Promise<boolean> {
        setError(null);
        try {
          const rep = await api.updateReply(replyId, body);
          updateReplies(commentId, (replies) => replies.map((r) => (r.id === replyId ? rep : r)));
          return true;
        } catch (e) {
          setError((e as Error).message);
          return false;
        }
      },

      async onDeleteReply(commentId: number, replyId: number) {
        setError(null);
        try {
          await api.deleteReply(replyId);
          updateReplies(commentId, (replies) => replies.filter((r) => r.id !== replyId));
        } catch (e) {
          setError((e as Error).message);
        }
      },

      async onResolve(id: number, resolved: boolean) {
        setError(null);
        setComments((cs) => cs.map((c) => (c.id === id ? { ...c, resolved } : c)));
        try {
          await api.setCommentResolved(id, resolved);
        } catch (e) {
          setComments((cs) => cs.map((c) => (c.id === id ? { ...c, resolved: !resolved } : c)));
          setError((e as Error).message);
        }
      },
    };
  }, [setComments, setError]);

  // The comments pane deletes without the rest of the thread actions; one implementation, so
  // a delete from the pane and a delete from a card can't drift apart.
  return { commentActions, handleAddComment, handleDelete: commentActions.onDelete };
}
