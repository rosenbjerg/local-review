import { turnOf } from "./commentTurn";
import type { Comment, CommentType } from "./types";
import { COMMENT_TYPES, effectivePath } from "./types";

// The comments pane's filters. Session state, not persisted: a remembered filter would open the pane already hiding comments.

export const ANY = "any";

// One select, two axes (how a thread stands, whose move it is): exclusive in practice, and a fourth select would crowd the row.
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
  // An exact root author, or ANY; authors are open-ended, so the choices come from the review.
  author: string;
  // Free text matched against the whole thread; blank means no narrowing.
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

// Replies don't count: the pane lists roots, so a reply-only author would filter to nothing.
export function authorsOf(comments: Comment[]): string[] {
  return [...new Set(comments.map((c) => c.author).filter(Boolean))].sort();
}

// The only place the raw query becomes a needle: the pane must highlight with the same needle it filtered by.
export function queryNeedle(query: string): string {
  return query.trim().toLowerCase();
}

// Matches the whole thread (replies included) and both paths, so a rename-moved comment is findable under either.
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
    // turnOf already calls a resolved thread "none", so neither turn value restates it.
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
