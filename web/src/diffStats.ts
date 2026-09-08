import type { FileDiff } from "./types";

// Per-file / whole-review counts off the hunks; callers memo the result, since this walks every line.

export interface DiffStat {
  added: number;
  removed: number;
}

export function fileStat(file: FileDiff): DiffStat {
  let added = 0;
  let removed = 0;
  for (const h of file.hunks) {
    for (const l of h.lines) {
      if (l.kind === "add") added++;
      else if (l.kind === "del") removed++;
    }
  }
  return { added, removed };
}

export function totalStat(files: FileDiff[]): DiffStat {
  let added = 0;
  let removed = 0;
  for (const f of files) {
    const s = fileStat(f);
    added += s.added;
    removed += s.removed;
  }
  return { added, removed };
}

// Binary files and synthetic unchanged cards have no hunks, so empty means "nothing to say", not "nothing changed".
export function isEmptyStat(s: DiffStat): boolean {
  return s.added === 0 && s.removed === 0;
}
