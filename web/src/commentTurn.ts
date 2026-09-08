import type { Comment } from "./types";

// Whose move a thread is waiting on. Derived from who spoke last, never stored.

// Reviewer vs not-reviewer, never a list of agent names: authors are open-ended (same rule as useUnseenActivity).
const REVIEWER = "reviewer";

export type Turn = "you" | "them" | "none";

// Timestamps are second-granular, so the highest reply id is the only dependable "last".
function lastAuthor(c: Comment): string {
  let last: { id: number; author: string } | null = null;
  for (const r of c.replies ?? []) if (!last || r.id > last.id) last = r;
  return last ? last.author : c.author;
}

// Resolved beats turn (or every dismissed finding would keep asking for a reply); outdated doesn't.
// A blank author is a pre-column row, backfilled as the reviewer's, so it reads as "them".
export function turnOf(c: Comment): Turn {
  if (c.resolved) return "none";
  const a = lastAuthor(c);
  return !a || a === REVIEWER ? "them" : "you";
}

// Counted over the whole review, not the filtered list, so narrowing on another axis can't read as "nothing left".
export function awaitingYouCount(comments: Comment[]): number {
  let n = 0;
  for (const c of comments) if (turnOf(c) === "you") n++;
  return n;
}
