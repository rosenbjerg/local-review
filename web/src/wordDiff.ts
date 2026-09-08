import type { Hunk } from "./types";

// Intra-line diffing: which parts of a changed line changed, so a one-character edit doesn't read as a rewrite.

// Half-open [start, end) character offsets into a line's content.
export type Range = [start: number, end: number];

export interface LineWordDiff {
  del: Range[];
  add: Range[];
}

// A minified bundle is one enormous "line"; these caps keep the quadratic LCS off it.
const MAX_CHARS = 1000;
const MAX_TOKENS = 200;
// Below this the two lines are different code, not an edit of the same code.
const MIN_SIMILARITY = 0.5;
// The per-file budget, mirroring the syntax highlighter's own ceiling.
const MAX_CHANGED_LINES = 2000;

// Word runs, whitespace runs, single punctuation: a diff lands on identifier boundaries, not mid-word.
const TOKEN = /[\p{L}\p{N}_$]+|\s+|[^\p{L}\p{N}_$\s]/gu;

export function tokenizeLine(line: string): string[] {
  return line.match(TOKEN) ?? [];
}

// Null when marking the ranges would say nothing the row's own add/del shade doesn't.
export function wordDiff(oldLine: string, newLine: string): LineWordDiff | null {
  if (oldLine === newLine) return null;
  if (oldLine.length > MAX_CHARS || newLine.length > MAX_CHARS) return null;
  const a = tokenizeLine(oldLine);
  const b = tokenizeLine(newLine);
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return null;

  // Trimming the shared head and tail first keeps the quadratic step off the common one-word change.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }

  const aChanged = new Array<boolean>(a.length).fill(false);
  const bChanged = new Array<boolean>(b.length).fill(false);
  const aMid = a.slice(head, a.length - tail);
  const bMid = b.slice(head, b.length - tail);

  if (aMid.length === 0 || bMid.length === 0) {
    for (let i = 0; i < aMid.length; i++) aChanged[head + i] = true;
    for (let i = 0; i < bMid.length; i++) bChanged[head + i] = true;
  } else {
    markDivergence(aMid, bMid, aChanged, bChanged, head);
  }

  let sharedChars = 0;
  for (let i = 0; i < a.length; i++) if (!aChanged[i]) sharedChars += a[i].length;
  if ((2 * sharedChars) / (oldLine.length + newLine.length) < MIN_SIMILARITY) return null;

  const del = rangesOf(a, aChanged);
  const add = rangesOf(b, bChanged);
  if (del.length === 0 && add.length === 0) return null;
  if (spansWholeLine(del, oldLine.length) && spansWholeLine(add, newLine.length)) return null;
  return { del, add };
}

function markDivergence(
  a: string[],
  b: string[],
  aChanged: boolean[],
  bChanged: boolean[],
  offset: number
): void {
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      aChanged[offset + i++] = true;
    } else {
      bChanged[offset + j++] = true;
    }
  }
  while (i < n) aChanged[offset + i++] = true;
  while (j < m) bChanged[offset + j++] = true;
}

function rangesOf(tokens: string[], changed: boolean[]): Range[] {
  const out: Range[] = [];
  let pos = 0;
  for (let i = 0; i < tokens.length; i++) {
    const end = pos + tokens[i].length;
    if (changed[i]) {
      const last = out[out.length - 1];
      if (last && last[1] === pos) last[1] = end;
      else out.push([pos, end]);
    }
    pos = end;
  }
  return out;
}

function spansWholeLine(ranges: Range[], length: number): boolean {
  return ranges.length === 1 && ranges[0][0] === 0 && ranges[0][1] === length;
}

export interface HunkWordRanges {
  del: Map<number, Range[]>;
  add: Map<number, Range[]>;
}

// Keyed by the line numbers rows carry — deletions by old line, additions by new — so both views look up alike.
export function hunkWordRanges(hunks: Hunk[]): HunkWordRanges {
  const out: HunkWordRanges = { del: new Map(), add: new Map() };
  let budget = MAX_CHANGED_LINES;
  for (const hunk of hunks) {
    const lines = hunk.lines;
    let i = 0;
    while (i < lines.length) {
      if (lines[i].kind !== "del") {
        i++;
        continue;
      }
      let d = i;
      while (d < lines.length && lines[d].kind === "del") d++;
      let a = d;
      while (a < lines.length && lines[a].kind === "add") a++;
      // Positional pairing within the run; wordDiff's similarity gate drops a bogus pair.
      const pairs = Math.min(d - i, a - d);
      for (let k = 0; k < pairs; k++) {
        if (budget-- <= 0) return out;
        const del = lines[i + k];
        const add = lines[d + k];
        const diff = wordDiff(del.content, add.content);
        if (!diff) continue;
        if (del.oldLine) out.del.set(del.oldLine, diff.del);
        if (add.newLine) out.add.set(add.newLine, diff.add);
      }
      i = Math.max(a, d);
    }
  }
  return out;
}

export interface Segment {
  text: string;
  color?: string;
}

export interface Piece extends Segment {
  changed: boolean;
}

// Cuts the highlighted segments at the range boundaries so colour and changedness compose. Ranges past the
// text are clamped: the segments and the hunks can briefly disagree after a stale read.
export function splitPieces(segments: Segment[], ranges: Range[]): Piece[] {
  const out: Piece[] = [];
  let pos = 0;
  let ri = 0;
  for (const seg of segments) {
    let start = 0;
    while (start < seg.text.length) {
      while (ri < ranges.length && ranges[ri][1] <= pos + start) ri++;
      const range = ranges[ri];
      const abs = pos + start;
      let end = seg.text.length;
      let changed = false;
      if (range && range[0] <= abs) {
        changed = true;
        end = Math.min(end, range[1] - pos);
      } else if (range) {
        end = Math.min(end, range[0] - pos);
      }
      out.push({ text: seg.text.slice(start, end), color: seg.color, changed });
      start = end;
    }
    pos += seg.text.length;
  }
  return out;
}
