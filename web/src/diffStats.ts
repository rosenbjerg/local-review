import type { FileDiff } from "./types";

// How much a file (or a whole review) changes, counted off the hunks the diff
// already carries. Walking every line is cheap once but not per render — callers
// hold the result behind a memo keyed on the file list.

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

// Binary files and the synthetic cards for unchanged files have no hunks, so an
// empty stat means "nothing to say" rather than "nothing changed".
export function isEmptyStat(s: DiffStat): boolean {
  return s.added === 0 && s.removed === 0;
}
