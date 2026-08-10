import type { Comment } from "./types";
import { effectivePath } from "./types";

export type PathGroups = ReadonlyMap<string, Comment[]>;

// Group comments under the file card that renders them — the effective path, so a
// rename-moved comment groups with its new file.
export function groupByPath(comments: readonly Comment[]): PathGroups {
  const groups = new Map<string, Comment[]>();
  for (const c of comments) {
    const path = effectivePath(c);
    if (!path) continue;
    const arr = groups.get(path);
    if (arr) arr.push(c);
    else groups.set(path, [c]);
  }
  return groups;
}

const NONE: Comment[] = [];

// One shared empty array for the many files with no comments, so their cards
// compare equal by identity rather than by value.
export function commentsFor(groups: PathGroups, path: string): Comment[] {
  return groups.get(path) ?? NONE;
}

export function sameComments(a: readonly Comment[], b: readonly Comment[]): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
