import { useEffect, useRef, useState } from "react";
import type { Comment } from "./types";

// The reviewer is this browser (or a second tab of it), so their own comments are
// never news. Everything else — the coding agent's replies, the review agent's
// findings — is activity that arrived on its own.
const REVIEWER = "reviewer";

export function agentItemIds(comments: Comment[]): Set<string> {
  const ids = new Set<string>();
  for (const c of comments) {
    if (c.author && c.author !== REVIEWER) ids.add(`c${c.id}`);
    for (const r of c.replies ?? []) {
      if (r.author && r.author !== REVIEWER) ids.add(`r${r.id}`);
    }
  }
  return ids;
}

// How much agent activity has landed since the tab was last looked at, for the tab
// title to carry. Handing a review to an agent means waiting somewhere else, and
// the tab is the only surface that can say "it answered" while you're in an editor.
//
// Keyed on visibility alone: hidden accumulates, visible clears. That's also the
// axis useReview's ping refetch uses — a hidden tab still pulls the review, which
// is what makes a count possible at all.
export function useUnseenActivity(comments: Comment[], reviewId?: number): number {
  const [unseen, setUnseen] = useState(0);
  // Null until the first read of a review: whatever is already on it when you open
  // it is history, not activity — including when you open it in a background tab.
  const seen = useRef<Set<string> | null>(null);
  const latest = useRef(comments);

  useEffect(() => {
    latest.current = comments;
  });

  // Declared before the counter below so a review switch primes against the new
  // review's comments rather than counting them all as new.
  useEffect(() => {
    seen.current = null;
    setUnseen(0);
  }, [reviewId]);

  useEffect(() => {
    const ids = agentItemIds(comments);
    if (seen.current === null || document.visibilityState === "visible") {
      seen.current = ids;
      setUnseen(0);
      return;
    }
    let n = 0;
    for (const id of ids) if (!seen.current.has(id)) n++;
    setUnseen(n);
  }, [comments]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      seen.current = agentItemIds(latest.current);
      setUnseen(0);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return unseen;
}
