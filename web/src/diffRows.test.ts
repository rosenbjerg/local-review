import { describe, expect, it } from "vitest";
import { buildRows, planRows, type Row } from "./diffRows";
import type { Comment, DiffLine, Hunk } from "./types";

const ctx = (oldLine: number, newLine: number, content = `l${newLine}`): DiffLine => ({
  kind: "context",
  oldLine,
  newLine,
  content,
});
const add = (newLine: number, content = `+${newLine}`): DiffLine => ({ kind: "add", newLine, content });
const del = (oldLine: number, content = `-${oldLine}`): DiffLine => ({ kind: "del", oldLine, content });

const comment = (id: number, over: Partial<Comment> = {}): Comment =>
  ({
    id,
    filePath: "a.ts",
    startLine: 1,
    endLine: 1,
    type: "suggestion",
    author: "reviewer",
    resolved: false,
    replies: [],
    ...over,
  }) as Comment;

const kinds = (rows: Row[]) => rows.map((r) => r.kind);
const lines = (rows: Row[]) => rows.map((r) => r.newLine);

// A file with one hunk touching new-side lines 10-12, in a 40-line file.
const oneHunk: Hunk[] = [
  { header: "@@ -10,2 +10,3 @@", lines: [ctx(10, 10), del(11), add(11), ctx(12, 12)] },
];
const source = Array.from({ length: 40 }, (_, i) => `line${i + 1}`);

describe("buildRows: full view", () => {
  it("renders the source and marks the additions from the hunks", () => {
    const rows = buildRows({ mode: "full", source: ["a", "b", "c"], hunks: [{ header: "@@ -1,1 +1,2 @@", lines: [add(2)] }], revealed: {} });
    expect(rows.map((r) => [r.key, r.kind, r.newLine, r.content])).toEqual([
      ["f1", "context", 1, "a"],
      ["f2", "add", 2, "b"],
      ["f3", "context", 3, "c"],
    ]);
  });

  it("renders no deleted rows, so a deletion leaves the numbering to the source", () => {
    const rows = buildRows({ mode: "full", source: ["a", "b"], hunks: oneHunk, revealed: {} });
    expect(kinds(rows)).toEqual(["context", "context"]);
  });

  // Full view has nothing to render until the file arrives, and DiffView fetches it
  // on the mode switch — so until then this falls back to the hunks rather than
  // rendering an empty table.
  it("falls back to the hunk rows when the source hasn't arrived", () => {
    const rows = buildRows({ mode: "full", source: null, hunks: oneHunk, revealed: {} });
    expect(kinds(rows)).toEqual(["hunk", "context", "del", "add", "context"]);
  });
});

describe("buildRows: changed view", () => {
  it("emits the @@ header then the hunk's own lines", () => {
    const rows = buildRows({ mode: "changed", source: null, hunks: oneHunk, revealed: {} });
    expect(rows.map((r) => [r.key, r.kind])).toEqual([
      ["h0", "hunk"],
      ["h0l0", "context"],
      ["h0l1", "del"],
      ["h0l2", "add"],
      ["h0l3", "context"],
    ]);
  });

  it("has nothing to show for a file the diff touched with no hunks", () => {
    expect(buildRows({ mode: "changed", source, hunks: [], revealed: {} })).toEqual([]);
  });

  // With the source in hand the hidden regions become expander bars, and the bar
  // carries the following hunk's header so the two never stack.
  it("collapses the regions around a hunk into gap rows carrying the header", () => {
    const rows = buildRows({ mode: "changed", source, hunks: oneHunk, revealed: {} });
    expect(kinds(rows)).toEqual(["gap", "context", "del", "add", "context", "gap"]);
    expect(rows[0].content).toBe("@@ -10,2 +10,3 @@"); // leading bar carries the header
    expect(rows[0].hidden).toBe(9); // lines 1-9
    expect(rows[5].content).toBe(""); // trailing bar has no hunk to announce
    expect(rows[5].hidden).toBe(28); // lines 13-40
  });

  it("reveals context out of the source, keeping the old-side gutter honest", () => {
    const rows = buildRows({ mode: "changed", source, hunks: oneHunk, revealed: { 0: { head: 0, tail: 3 } } });
    const revealed = rows.filter((r) => r.key.startsWith("g0c"));
    expect(revealed.map((r) => [r.newLine, r.oldLine, r.content])).toEqual([
      [7, 7, "line7"],
      [8, 8, "line8"],
      [9, 9, "line9"],
    ]);
    expect(rows[0].hidden).toBe(6); // 9 hidden, 3 now shown
  });

  // A fully revealed gap emits neither bar nor header: the lines run continuously
  // into the hunk, so the header would be noise.
  it("emits neither bar nor header once a gap is fully revealed", () => {
    const rows = buildRows({ mode: "changed", source, hunks: oneHunk, revealed: { 0: { head: 9, tail: 0 } } });
    expect(rows.filter((r) => r.kind === "gap").map((r) => r.key)).toEqual(["g1"]);
    expect(rows.some((r) => r.kind === "hunk")).toBe(false);
    expect(lines(rows).slice(0, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("carries a gap's old-side offset into the rows it reveals", () => {
    // The hunk adds a line, so the region after it runs one lower on the old side.
    const rows = buildRows({ mode: "changed", source, hunks: oneHunk, revealed: { 1: { head: 2, tail: 0 } } });
    const revealed = rows.filter((r) => r.key.startsWith("g1c"));
    expect(revealed.map((r) => [r.newLine, r.oldLine])).toEqual([
      [13, 12],
      [14, 13],
    ]);
  });
});

describe("planRows", () => {
  const changed = () => buildRows({ mode: "changed", source: null, hunks: oneHunk, revealed: {} });
  const plain = (over = {}) =>
    planRows({ rows: changed(), comments: [], selection: null, dragging: false, activeComment: null, ...over });

  it("leaves metadata rows inert", () => {
    const rows = buildRows({ mode: "changed", source, hunks: oneHunk, revealed: {} });
    const plan = planRows({ rows, comments: [], selection: null, dragging: false, activeComment: null });
    for (const p of plan.rows) {
      if (p.row.kind === "gap" || p.row.kind === "hunk") expect(p.commentable).toBe(false);
    }
  });

  // Commenting anchors to the new side, so a deletion has nothing to anchor to.
  it("makes only rows with a new-side line commentable", () => {
    const plan = plain();
    expect(plan.rows.map((p) => [p.row.kind, p.commentable])).toEqual([
      ["hunk", false],
      ["context", true],
      ["del", false],
      ["add", true],
      ["context", true],
    ]);
  });

  it("hangs a thread under its anchored end line", () => {
    const c = comment(1, { startLine: 10, endLine: 12 });
    const plan = planRows({ rows: changed(), comments: [c], selection: null, dragging: false, activeComment: null });
    const withThreads = plan.rows.filter((p) => p.threads.length > 0);
    expect(withThreads).toHaveLength(1);
    expect(withThreads[0].row.newLine).toBe(12); // the end, not the start
    expect(plan.leftover).toEqual([]);
  });

  it("follows a moved comment to its current line", () => {
    const moved = comment(1, {
      startLine: 30,
      endLine: 30,
      anchorStatus: "moved",
      currentStartLine: 11,
      currentEndLine: 11,
    });
    const plan = planRows({ rows: changed(), comments: [moved], selection: null, dragging: false, activeComment: null });
    expect(plan.rows.find((p) => p.threads.length > 0)?.row.newLine).toBe(11);
    expect(plan.leftover).toEqual([]);
  });

  it("shades every line in a comment's range, not just its anchor", () => {
    const c = comment(1, { startLine: 10, endLine: 12 });
    const plan = planRows({ rows: changed(), comments: [c], selection: null, dragging: false, activeComment: null });
    expect(plan.rows.filter((p) => p.commented).map((p) => p.row.newLine)).toEqual([10, 11, 12]);
  });

  // A line-0 comment is about the file. It must reach fileComments and *not* the
  // leftover bucket, which exists for a comment whose line isn't on screen.
  it("routes a line-0 comment to the file block, not to leftover", () => {
    const file = comment(1, { startLine: 0, endLine: 0 });
    const plan = planRows({ rows: changed(), comments: [file], selection: null, dragging: false, activeComment: null });
    expect(plan.fileComments.map((c) => c.id)).toEqual([1]);
    expect(plan.leftover).toEqual([]);
    expect(plan.rows.every((p) => p.threads.length === 0)).toBe(true);
  });

  it("collects a comment whose line isn't on screen", () => {
    const offscreen = comment(1, { startLine: 30, endLine: 30 });
    const onscreen = comment(2, { startLine: 12, endLine: 12 });
    const plan = planRows({
      rows: changed(),
      comments: [offscreen, onscreen],
      selection: null,
      dragging: false,
      activeComment: null,
    });
    expect(plan.leftover.map((c) => c.id)).toEqual([1]);
  });

  it("marks the selection's rows and puts the composer under its end", () => {
    const plan = planRows({
      rows: changed(),
      comments: [],
      selection: { start: 10, end: 12 },
      dragging: false,
      activeComment: null,
    });
    expect(plan.rows.filter((p) => p.selected).map((p) => p.row.newLine)).toEqual([10, 11, 12]);
    expect(plan.rows.filter((p) => p.composer).map((p) => p.row.newLine)).toEqual([12]);
    expect(plan.trailingComposer).toBe(false);
  });

  // While the mouse is down the selection is still growing, so a composer would
  // flicker under each row the drag passes over.
  it("withholds the composer while a drag is in progress", () => {
    const plan = planRows({
      rows: changed(),
      comments: [],
      selection: { start: 10, end: 12 },
      dragging: true,
      activeComment: null,
    });
    expect(plan.rows.some((p) => p.composer)).toBe(false);
    expect(plan.trailingComposer).toBe(false);
    expect(plan.rows.filter((p) => p.selected).map((p) => p.row.newLine)).toEqual([10, 11, 12]);
  });

  // The two composer positions are mutually exclusive: exactly one, or none.
  it("falls back to a trailing composer when the selection's end isn't rendered", () => {
    const plan = planRows({
      rows: changed(),
      comments: [],
      selection: { start: 30, end: 30 },
      dragging: false,
      activeComment: null,
    });
    expect(plan.rows.some((p) => p.composer)).toBe(false);
    expect(plan.trailingComposer).toBe(true);
  });

  it("lights the active thread's rows and ignores one from another file", () => {
    const c = comment(7, { startLine: 10, endLine: 11 });
    const here = planRows({ rows: changed(), comments: [c], selection: null, dragging: false, activeComment: 7 });
    expect(here.rows.filter((p) => p.active).map((p) => p.row.newLine)).toEqual([10, 11]);

    const elsewhere = planRows({ rows: changed(), comments: [c], selection: null, dragging: false, activeComment: 99 });
    expect(elsewhere.rows.some((p) => p.active)).toBe(false);
  });

  it("keeps several threads on one line together, in order", () => {
    const a = comment(1, { startLine: 12, endLine: 12 });
    const b = comment(2, { startLine: 12, endLine: 12 });
    const plan = planRows({ rows: changed(), comments: [a, b], selection: null, dragging: false, activeComment: null });
    const row = plan.rows.find((p) => p.threads.length > 0);
    expect(row?.threads.map((c) => c.id)).toEqual([1, 2]);
    expect(plan.leftover).toEqual([]);
  });
});
