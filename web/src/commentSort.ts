import type { Comment } from "./types";
import { effectiveLines, effectivePath } from "./types";

export type CommentSort = "file" | "started" | "activity";

export const COMMENT_SORTS: { value: CommentSort; label: string }[] = [
  { value: "file", label: "File order" },
  { value: "started", label: "Thread started" },
  { value: "activity", label: "Latest activity" },
];

export function isCommentSort(v: string): v is CommentSort {
  return COMMENT_SORTS.some((s) => s.value === v);
}

function time(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

// The last time anything in the thread changed. Resolving deliberately doesn't
// bump the comment's updated_at (see store.SetCommentResolved), so it doesn't
// count as activity here either.
export function lastActivityAt(c: Comment): string {
  let best = c.createdAt;
  const consider = (iso: string) => {
    if (iso && time(iso) > time(best)) best = iso;
  };
  consider(c.updatedAt);
  for (const r of c.replies ?? []) {
    consider(r.createdAt);
    consider(r.updatedAt);
  }
  return best;
}

export function sortTimestamp(c: Comment, sort: CommentSort): string {
  if (sort === "started") return c.createdAt;
  if (sort === "activity") return lastActivityAt(c);
  return "";
}

function itemKey(c: Comment, sort: CommentSort): number {
  switch (sort) {
    case "file":
      return effectiveLines(c).start;
    case "started":
      return time(c.createdAt);
    case "activity":
      return time(lastActivityAt(c));
  }
}

// Comments group by file in every sort, so ordering is two-level: the item order
// within a file, and the file order. Timestamps are second-granular (the store
// writes RFC3339), so batch-created comments tie constantly — id keeps that
// stable.
export function sortComments(
  comments: Comment[],
  sort: CommentSort,
  fileOrder: string[]
): Comment[] {
  const desc = sort === "activity";
  const byFile = new Map<string, Comment[]>();
  for (const c of comments) {
    const p = effectivePath(c);
    const arr = byFile.get(p);
    if (arr) arr.push(c);
    else byFile.set(p, [c]);
  }

  for (const arr of byFile.values()) {
    arr.sort((a, b) => {
      if (!!a.resolved !== !!b.resolved) return a.resolved ? 1 : -1;
      const d = itemKey(a, sort) - itemKey(b, sort);
      if (d !== 0) return desc ? -d : d;
      return a.id - b.id;
    });
  }

  // A file sits where its first-listed comment would sit in a flat sort, so the
  // grouped list reads as that flat order with each file hoisted to its first
  // appearance. Reading the key after the within-file sort keeps a bumped
  // resolved thread — which sinks to the bottom of its group — from hoisting its
  // file to the top.
  const orderIndex = new Map(fileOrder.map((p, i) => [p, i]));
  const groupKey = (path: string, items: Comment[]) =>
    sort === "file" ? (orderIndex.get(path) ?? Infinity) : itemKey(items[0], sort);

  return [...byFile.entries()]
    .sort(([pa, a], [pb, b]) => {
      const ka = groupKey(pa, a);
      const kb = groupKey(pb, b);
      if (ka === kb) return pa.localeCompare(pb);
      return desc ? kb - ka : ka - kb;
    })
    .flatMap(([, items]) => items);
}
