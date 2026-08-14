import type { Comment } from "./types";

// Whose move a thread is waiting on — the third derived view of the comment list,
// after commentSort's orderings and commentFilter's axes. Handing a review to an
// agent turns the pane into a two-way conversation, and the one thing a sort can't
// say is which threads have come back to you.
//
// Derived, never stored: it falls straight out of who spoke last, the same way
// anchorStatus falls out of the current file.

// The reviewer is this browser, so a thread whose newest item is theirs is waiting
// on the other side. The binary is reviewer vs not-reviewer rather than a list of
// agent names, because authors are open-ended (an API client sends its own) —
// same constant and same reason as useUnseenActivity.
const REVIEWER = "reviewer";

export type Turn = "you" | "them" | "none";

// The author of the newest item in the thread. Timestamps are second-granular
// (store.go writes RFC3339), so a batch of replies ties constantly and the id
// order is the only dependable "last".
function lastAuthor(c: Comment): string {
  let last: { id: number; author: string } | null = null;
  for (const r of c.replies ?? []) if (!last || r.id > last.id) last = r;
  return last ? last.author : c.author;
}

// Resolved beats turn: a resolved thread waits on nobody, whatever was said last,
// or every dismissed finding would keep asking for a reply. Outdated deliberately
// does not — the line moved, the question didn't.
//
// A blank author is a row from before the column existed, and those backfill as
// the reviewer's (the DDL default), so blank reads as "them" rather than as an
// unanswered agent.
export function turnOf(c: Comment): Turn {
  if (c.resolved) return "none";
  const a = lastAuthor(c);
  return !a || a === REVIEWER ? "them" : "you";
}

// How many threads are waiting on the reviewer. Deliberately taken over the whole
// review rather than the pane's filtered list: it's the number you act on, so a
// narrowing on some other axis must not make it read as "nothing left to do".
export function awaitingYouCount(comments: Comment[]): number {
  let n = 0;
  for (const c of comments) if (turnOf(c) === "you") n++;
  return n;
}
