import type { Comment, CommentType } from "./types";
import { COMMENT_TYPES } from "./types";

// The comments pane's filters, the counterpart to commentSort's orderings. Session
// state, deliberately not persisted: a filter remembered from yesterday would open
// the pane already hiding comments, and a pane that silently omits feedback is
// worse than one that needs re-narrowing.

export const ANY = "any";

export type StatusFilter = typeof ANY | "open" | "resolved" | "outdated";
export type TypeFilter = typeof ANY | CommentType;

export interface CommentFilter {
  status: StatusFilter;
  type: TypeFilter;
  // An exact root author, or ANY. Authors are open-ended (an API client sets its
  // own), so the choices come from the review rather than a fixed list.
  author: string;
}

export const NO_FILTER: CommentFilter = { status: ANY, type: ANY, author: ANY };

export const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: ANY, label: "Any status" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "outdated", label: "Outdated" },
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

export function isFiltered(f: CommentFilter): boolean {
  return f.status !== ANY || f.type !== ANY || f.author !== ANY;
}

function matchesStatus(c: Comment, status: StatusFilter): boolean {
  switch (status) {
    case "open":
      return !c.resolved;
    case "resolved":
      return !!c.resolved;
    case "outdated":
      return c.anchorStatus === "outdated";
    default:
      return true;
  }
}

export function matchesFilter(c: Comment, f: CommentFilter): boolean {
  return (
    matchesStatus(c, f.status) &&
    (f.type === ANY || c.type === f.type) &&
    (f.author === ANY || c.author === f.author)
  );
}

export function filterComments(comments: Comment[], f: CommentFilter): Comment[] {
  if (!isFiltered(f)) return comments;
  return comments.filter((c) => matchesFilter(c, f));
}
