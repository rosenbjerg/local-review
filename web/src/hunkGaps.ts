import type { Hunk } from "./types";

// The unchanged regions Changed view hides — the geometry behind the diff's expanders.

export const EXPAND_STEP = 20;

// `@@ -oldStart,oldCount +newStart,newCount @@ …`; a count of 1 is written as a bare start.
const HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

interface Span {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

function parseHeader(header: string): Span | null {
  const m = HEADER.exec(header);
  if (!m) return null;
  return {
    oldStart: Number(m[1]),
    oldCount: m[2] === undefined ? 1 : Number(m[2]),
    newStart: Number(m[3]),
    newCount: m[4] === undefined ? 1 : Number(m[4]),
  };
}

// git writes a zero-length side as the line *before* the change (`+4,0` = after new line 4), so both edges shift by one.
const lastBefore = (start: number, count: number) => (count === 0 ? start : start - 1);
const lastOf = (start: number, count: number) => (count === 0 ? start : start + count - 1);

export interface Gap {
  // The hunk this gap precedes; `hunks.length` for the region after the last one.
  hunkIndex: number;
  start: number;
  end: number;
  // `oldLine = newLine + delta` holds throughout, since a gap contains no changes.
  delta: number;
}

export function hunkGaps(hunks: Hunk[], totalLines: number): Gap[] {
  if (hunks.length === 0 || totalLines <= 0) return [];
  const spans: Span[] = [];
  for (const h of hunks) {
    const span = parseHeader(h.header);
    // One unreadable header would misplace every gap after it, so offer none.
    if (!span) return [];
    spans.push(span);
  }

  const gaps: Gap[] = [];
  const add = (hunkIndex: number, start: number, end: number, delta: number) => {
    const last = Math.min(end, totalLines);
    if (start <= last) gaps.push({ hunkIndex, start, end: last, delta });
  };
  spans.forEach((s, i) => {
    const prev = spans[i - 1];
    const start = prev ? lastOf(prev.newStart, prev.newCount) + 1 : 1;
    const end = lastBefore(s.newStart, s.newCount);
    add(i, start, end, lastBefore(s.oldStart, s.oldCount) - end);
  });
  const last = spans[spans.length - 1];
  const tailStart = lastOf(last.newStart, last.newCount);
  add(
    spans.length,
    tailStart + 1,
    totalLines,
    lastOf(last.oldStart, last.oldCount) - tailStart
  );
  return gaps;
}

export interface Reveal {
  // Lines revealed from the top of the gap and from its bottom.
  head: number;
  tail: number;
}

export interface GapView {
  head: { start: number; end: number } | null;
  tail: { start: number; end: number } | null;
  hidden: number;
}

export function gapView(gap: Gap, reveal?: Reveal): GapView {
  const size = gap.end - gap.start + 1;
  const head = Math.min(Math.max(reveal?.head ?? 0, 0), size);
  const tail = Math.min(Math.max(reveal?.tail ?? 0, 0), size - head);
  return {
    head: head > 0 ? { start: gap.start, end: gap.start + head - 1 } : null,
    tail: tail > 0 ? { start: gap.end - tail + 1, end: gap.end } : null,
    hidden: size - head - tail,
  };
}
