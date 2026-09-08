import { gapView, hunkGaps, type Gap, type Reveal } from "./hunkGaps";
import { effectiveLines, type Comment, type Hunk, type LineKind } from "./types";

// One line of the diff table. "hunk"/"gap" rows are metadata, not file text: no line numbers, and the
// DOM keeps `row-hunk` on each so occurrence highlighting skips them.
export interface Row {
  key: string;
  kind: LineKind | "hunk" | "gap";
  oldLine?: number;
  newLine?: number;
  content: string;
  // On a "gap" row: the hidden region its expanders act on, and how much is still hidden.
  gap?: Gap;
  hidden?: number;
}

// Full view: the source with adds marked from the hunks; Changed view: the hunks plus an expander bar per gap.
export function buildRows(args: {
  mode: "changed" | "full";
  source: string[] | null;
  hunks: Hunk[];
  revealed: Record<number, Reveal>;
}): Row[] {
  const { mode, source, hunks, revealed } = args;

  if (mode === "full" && source) {
    const added = addedLines(hunks);
    return source.map((content, i) => {
      const newLine = i + 1;
      return {
        key: `f${newLine}`,
        kind: added.has(newLine) ? "add" : "context",
        newLine,
        content,
      } as Row;
    });
  }

  const out: Row[] = [];
  // A reveal reads the already-fetched source, so with no source there are no gaps.
  const gaps = mode === "changed" && source ? hunkGaps(hunks, source.length) : [];
  const gapByHunk = new Map(gaps.map((g) => [g.hunkIndex, g]));

  const pushGap = (gap: Gap, header: string) => {
    const view = gapView(gap, revealed[gap.hunkIndex]);
    const context = (n: number) =>
      out.push({
        key: `g${gap.hunkIndex}c${n}`,
        kind: "context",
        // Holds only because a gap contains no changes.
        oldLine: n + gap.delta,
        newLine: n,
        content: source?.[n - 1] ?? "",
      });
    if (view.head) for (let n = view.head.start; n <= view.head.end; n++) context(n);
    if (view.hidden > 0) {
      out.push({ key: `g${gap.hunkIndex}`, kind: "gap", content: header, gap, hidden: view.hidden });
    }
    if (view.tail) for (let n = view.tail.start; n <= view.tail.end; n++) context(n);
  };

  hunks.forEach((h, hi) => {
    const gap = gapByHunk.get(hi);
    // The bar carries the hunk's @@ header so the two never stack; a fully revealed gap emits neither.
    if (gap) pushGap(gap, h.header);
    else out.push({ key: `h${hi}`, kind: "hunk", content: h.header });
    h.lines.forEach((l, li) => {
      out.push({
        key: `h${hi}l${li}`,
        kind: l.kind,
        oldLine: l.oldLine,
        newLine: l.newLine,
        content: l.content,
      });
    });
  });
  const trailing = gapByHunk.get(hunks.length);
  if (trailing) pushGap(trailing, "");
  return out;
}

function addedLines(hunks: Hunk[]): Set<number> {
  const s = new Set<number>();
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.kind === "add" && l.newLine) s.add(l.newLine);
    }
  }
  return s;
}

export interface LineRange {
  start: number;
  end: number;
}

export interface PlannedRow {
  row: Row;
  // Comments anchor to the new side; a deletion or @@ header has no new-side line, so its gutter stays inert.
  commentable: boolean;
  selected: boolean;
  commented: boolean;
  active: boolean;
  threads: Comment[];
  composer: boolean;
}

export interface RowPlan {
  rows: PlannedRow[];
  // Line-0 comments are about the file, not a row; they render in their own block below the table.
  fileComments: Comment[];
  // Comments whose line isn't on screen (hidden by Changed view, or outdated), collected so they don't vanish.
  leftover: Comment[];
  // The selection's end row isn't rendered, so the composer can't sit under it.
  trailingComposer: boolean;
}

// Kept pure so the rules stay testable: a thread is placed by its *effective end* line, `leftover` is
// whatever the walk didn't render, and the inline composer and its trailing fallback are mutually exclusive.
export function planRows(args: {
  rows: Row[];
  comments: Comment[];
  selection: LineRange | null;
  // While dragging the composer waits, or it would flicker under every row the selection passes.
  dragging: boolean;
  activeComment: number | null;
}): RowPlan {
  const { rows, comments, selection, dragging, activeComment } = args;

  const byEndLine = new Map<number, Comment[]>();
  const commented = new Set<number>();
  const fileComments: Comment[] = [];
  for (const c of comments) {
    const { start, end } = effectiveLines(c);
    if (start === 0) {
      fileComments.push(c);
      continue;
    }
    const at = byEndLine.get(end);
    if (at) at.push(c);
    else byEndLine.set(end, [c]);
    for (let n = start; n <= end; n++) commented.add(n);
  }

  // The thread jumped to (n/p or the pane), if it's in this file; its rows stay lit until another is picked.
  const active = activeComment == null ? null : comments.find((c) => c.id === activeComment);
  const activeRange = active ? effectiveLines(active) : null;

  const placeable = selection != null && !dragging;
  const rendered = new Set<number>();
  let composerPlaced = false;

  const planned: PlannedRow[] = rows.map((row) => {
    if (row.kind === "hunk" || row.kind === "gap") {
      return { row, commentable: false, selected: false, commented: false, active: false, threads: [], composer: false };
    }
    const line = row.newLine;
    const threads = line ? (byEndLine.get(line) ?? []) : [];
    for (const c of threads) rendered.add(c.id);
    const composer = !!line && placeable && line === selection.end;
    if (composer) composerPlaced = true;
    return {
      row,
      commentable: !!line && row.kind !== "del",
      selected: !!line && selection != null && line >= selection.start && line <= selection.end,
      commented: !!line && commented.has(line),
      active: !!line && activeRange != null && line >= activeRange.start && line <= activeRange.end,
      threads,
      composer,
    };
  });

  return {
    rows: planned,
    fileComments,
    leftover: comments.filter((c) => effectiveLines(c).start !== 0 && !rendered.has(c.id)),
    trailingComposer: placeable && !composerPlaced,
  };
}
