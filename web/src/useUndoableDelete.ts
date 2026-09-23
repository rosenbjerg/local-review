import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ApiError, api } from "./api";
import type { Comment } from "./types";

export const UNDO_MS = 6000;

interface Params {
  setComments: Dispatch<SetStateAction<Comment[]>>;
  setError: (msg: string | null) => void;
  reviewId: number | undefined;
}

export function useUndoableDelete({ setComments, setError, reviewId }: Params) {
  const [pending, setPending] = useState<number | null>(null);
  // Still hidden until the server confirms, or an SSE refetch landing first flashes it back.
  const [committing, setCommitting] = useState<number[]>([]);
  const pendingRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  const commit = useCallback(
    async (id: number) => {
      setCommitting((ids) => [...ids, id]);
      let failed: string | null = null;
      try {
        await api.deleteComment(id);
      } catch (e) {
        // Already gone (a reset, an agent) is what was asked for.
        if (!(e instanceof ApiError && e.status === 404)) failed = (e as Error).message;
      }
      if (failed === null) setComments((cs) => cs.filter((c) => c.id !== id));
      else setError(failed);
      setCommitting((ids) => ids.filter((x) => x !== id));
    },
    [setComments, setError]
  );

  const flush = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    const id = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (id !== null) void commit(id);
  }, [commit]);

  const remove = useCallback(
    async (id: number) => {
      flush();
      setError(null);
      pendingRef.current = id;
      setPending(id);
      timerRef.current = window.setTimeout(flush, UNDO_MS);
    },
    [flush, setError]
  );

  const undo = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingRef.current = null;
    setPending(null);
  }, []);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => () => flushRef.current(), [reviewId]);

  useEffect(() => {
    const onPageHide = () => {
      const id = pendingRef.current;
      if (id === null) return;
      pendingRef.current = null;
      void api.deleteComment(id, { keepalive: true }).catch(() => {});
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  const hidden = useMemo(
    () => new Set(pending === null ? committing : [...committing, pending]),
    [pending, committing]
  );
  return { pending, hidden, remove, undo };
}
