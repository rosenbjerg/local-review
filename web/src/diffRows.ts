import { gapView, hunkGaps, type Gap, type Reveal } from "./hunkGaps";
import { effectiveLines, type Comment, type Hunk, type LineKind } from "./types";

// One line of the diff table. "hunk" is an @@ header, "gap" the expander bar over a
// hidden region; both are metadata rather than file text, which is why they carry no
// line numbers and why the DOM keeps `row-hunk` on each (occurrence highlighting
// reads that class to know the cell isn't searchable content).
export interface Row {
  key: string;
  kind: LineKind | "hunk" | "gap";
  oldLine?: number;
  newLine?: number;
  content: string;
  // On a "gap" row: the hidden region its expanders act on, and how much of that
  // region is still hidden.
  gap?: Gap;
  hidden?: number;
}

// buildRows turns a file into the rows a view renders. Full view is the source with
// additions marked from the hunks; Changed view is the hunks, with the unchanged
// regions between them collapsed to an expander bar carrying however much the
// reviewer has revealed.
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
  // Only Changed view hides anything, and the reveal comes out of the already-fetched
  // source — so with no source there is nothing to expand into and no gaps.
  const gaps = mode === "changed" && source ? hunkGaps(hunks, source.length) : [];
  const gapByHunk = new Map(gaps.map((g) => [g.hunkIndex, g]));

  const pushGap = (gap: Gap, header: string) => {
    const view = gapView(gap, revealed[gap.hunkIndex]);
    const context = (n: number) =>
      out.push({
        key: `g${gap.hunkIndex}c${n}`,
        kind: "context",
        // A gap contains no changes by definition, which is the only reason this
        // constant offset can keep the old-side gutter honest in a revealed row.
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
    // A hidden region's bar carries the hunk's @@ header, so the two never stack.
    // Once the region is fully revealed the lines run continuously into the hunk and
    // the header would be noise, so neither row is emitted.
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

// A row plus every decision about it that isn't rendering: how it's shaded, whether
// its gutter takes a click, and what belongs underneath it.
export interface PlannedRow {
  row: Row;
  // Commenting anchors to the new side, so a row with no new-side line — a deletion,
  // an @@ header — has nothing to anchor to and its gutter stays inert.
  commentable: boolean;
  selected: boolean;
  commented: boolean;
  active: boolean;
  // Threads anchored to this row's line, rendered under it.
  threads: Comment[];
  // The new-comment composer goes under this row (the selection ends here).
  composer: boolean;
}

export interface RowPlan {
  rows: PlannedRow[];
  // Line-0 comments: about the file, not any row, so they render in their own block
  // below the table — the same place the media and rendered-markdown views put them.
  fileComments: Comment[];
  // Comments whose anchored line isn't among the rows on screen (Changed view hiding
  // it, or an outdated anchor). They'd otherwise vanish, so they collect at the end.
  leftover: Comment[];
  // The selection's end row isn't rendered, so the composer can't sit under it.
  trailingComposer: boolean;
}

// planRows decides what the diff table shows: which rows are shaded how, which
// threads hang under which row, and where the composer goes — including the two
// fallbacks that keep a comment from disappearing when its line isn't on screen.
//
// It is separate from the rendering, and pure, because this is the part with the
// non-obvious rules: a thread is placed by its *effective end* line (so a moved
// comment follows its code), "leftover" is defined by what the walk actually
// rendered rather than by any property of a comment, and the composer has an
// inline position and a fallback that must be mutually exclusive. Rendered inline
// with the JSX, none of that could be tested without a DOM.
export function planRows(args: {
  rows: Row[];
  comments: Comment[];
  selection: LineRange | null;
  // A drag in progress: the composer waits for the mouse to come up, so the
  // selection can grow without a composer flickering under each row it passes.
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

  // The range of the thread jumped to (n/p or the comments pane), if it's in this
  // file — its rows stay lit until another is picked.
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
