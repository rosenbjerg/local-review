import { turnOf } from "./commentTurn";
import type { Comment, CommentType } from "./types";
import { COMMENT_TYPES, effectivePath } from "./types";

// The comments pane's filters, the counterpart to commentSort's orderings. Session
// state, deliberately not persisted: a filter remembered from yesterday would open
// the pane already hiding comments, and a pane that silently omits feedback is
// worse than one that needs re-narrowing.

export const ANY = "any";

// One select, two axes: how a thread stands (open/resolved/outdated) and whose
// move it is (see commentTurn). They're kept together because the answers are
// mutually exclusive in practice — a resolved thread has no turn — and a fourth
// select would crowd the filter row for a choice nobody combines.
export type StatusFilter =
  | typeof ANY
  | "open"
  | "resolved"
  | "outdated"
  | "awaiting-you"
  | "awaiting-them";
export type TypeFilter = typeof ANY | CommentType;

export interface CommentFilter {
  status: StatusFilter;
  type: TypeFilter;
  // An exact root author, or ANY. Authors are open-ended (an API client sets its
  // own), so the choices come from the review rather than a fixed list.
  author: string;
  // Free text, matched against the whole thread (see matchesQuery). Blank means
  // no narrowing — it's the query's ANY.
  query: string;
}

export const NO_FILTER: CommentFilter = { status: ANY, type: ANY, author: ANY, query: "" };

export const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: ANY, label: "Any status" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "outdated", label: "Outdated" },
  { value: "awaiting-you", label: "Awaiting you" },
  { value: "awaiting-them", label: "Awaiting agent" },
];

export const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: ANY, label: "Any type" },
  ...COMMENT_TYPES.map((t) => ({ value: t, label: t })),
];

// The authors who started a thread here. Replies don't count: the pane lists roots,
// so an author with only replies would filter to nothing.
export function authorsOf(comments: Comment[]): string[] {
  return [...new Set(comments.map((c) => c.author).filter(Boolean))].sort();
}

// The needle a query narrows by: trimmed and lowercased, so matching is
// case-insensitive and a whitespace-only query narrows nothing. Everything that
// acts on the query goes through this — the pane highlights matches with the same
// needle it filtered with, or it would mark text that isn't why the row is there.
export function queryNeedle(query: string): string {
  return query.trim().toLowerCase();
}

// A plain case-insensitive substring, matched against the thread rather than the
// root comment alone: the pane lists roots, so a term that only appears in a reply
// still has to surface the thread that holds it. Both paths count, so a
// rename-moved comment is findable under either its old or its new home.
function matchesQuery(c: Comment, needle: string): boolean {
  if (!needle) return true;
  const has = (s: string | undefined) => !!s && s.toLowerCase().includes(needle);
  return (
    has(c.body) ||
    has(effectivePath(c)) ||
    has(c.filePath) ||
    (c.replies ?? []).some((r) => has(r.body))
  );
}

export function isFiltered(f: CommentFilter): boolean {
  return f.status !== ANY || f.type !== ANY || f.author !== ANY || queryNeedle(f.query) !== "";
}

function matchesStatus(c: Comment, status: StatusFilter): boolean {
  switch (status) {
    case "open":
      return !c.resolved;
    case "resolved":
      return !!c.resolved;
    case "outdated":
      return c.anchorStatus === "outdated";
    // Both turn values already exclude resolved threads — turnOf calls those
    // "none" — so neither needs to restate it.
    case "awaiting-you":
      return turnOf(c) === "you";
    case "awaiting-them":
      return turnOf(c) === "them";
    default:
      return true;
  }
}

export function matchesFilter(c: Comment, f: CommentFilter): boolean {
  return (
    matchesStatus(c, f.status) &&
    (f.type === ANY || c.type === f.type) &&
    (f.author === ANY || c.author === f.author) &&
    matchesQuery(c, queryNeedle(f.query))
  );
}

export function filterComments(comments: Comment[], f: CommentFilter): Comment[] {
  if (!isFiltered(f)) return comments;
  return comments.filter((c) => matchesFilter(c, f));
}
