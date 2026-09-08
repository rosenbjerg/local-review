import { useEffect, useRef, useState } from "react";
import type { Comment } from "./types";

// The reviewer's own comments come from this browser and are never news; everything else is activity.
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

// Agent activity that landed while the tab was hidden, for the tab title. Keyed on visibility alone — the same
// axis the ping refetch uses, so a hidden tab still has a review to count against.
export function useUnseenActivity(comments: Comment[], reviewId?: number): number {
  const [unseen, setUnseen] = useState(0);
  // Null until the first read: whatever is already on a review when it opens is history, not activity.
  const seen = useRef<Set<string> | null>(null);
  const latest = useRef(comments);

  useEffect(() => {
    latest.current = comments;
  });

  // Runs before the counter below, so a review switch primes against the new review's comments.
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
