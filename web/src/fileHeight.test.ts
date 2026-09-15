import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  MONO_BASE_PX,
  MONO_LINE_RATIO,
  diffRowHeight,
  estFileHeight,
  LARGE_FILE_LINES,
} from "./fileHeight";
import type { Comment, FileDiff } from "./types";

const file = (o: Partial<FileDiff>): FileDiff =>
  ({ oldPath: "a.go", newPath: "a.go", status: "modified", hunks: [], ...o }) as FileDiff;

const hunk = (n: number) => ({
  header: "@@ -1,1 +1,1 @@",
  lines: Array.from({ length: n }, () => ({ kind: "context" as const, content: "x" })),
});

const comment = (o: Partial<Comment>): Comment =>
  ({ id: 1, resolved: false, replies: [], ...o }) as Comment;

const est = (f: FileDiff, o: Partial<Parameters<typeof estFileHeight>[0]> = {}) =>
  estFileHeight({ file: f, reviewed: false, comments: [], rowH: 19, ...o });

// The row height is derived from the code font size, which the user sets. Read it off styles.css
// rather than trusting the copy here: a placeholder sized at the wrong scale shifts every card
// below it the moment it mounts.
test("the mono metrics match the stylesheet they mirror", () => {
  const css = readFileSync(join(__dirname, "styles.css"), "utf8");
  expect(css).toContain(`--font-size-mono: calc(${MONO_BASE_PX}px + var(--mono-offset));`);
  expect(css).toContain(`line-height: calc(var(--font-size-mono) * ${MONO_LINE_RATIO});`);
});

test("the row height follows the font offset", () => {
  expect(diffRowHeight(0)).toBeCloseTo(19);
  expect(diffRowHeight(8)).toBeCloseTo(31.16);
  expect(diffRowHeight(-4)).toBeCloseTo(12.92);
});

// A hunkless file in the diff — an R100 rename, a mode change, an empty add — renders one note row,
// not a whole file. Only a synthetic `unchanged` card opens in Full view on an unknown length.
test("a hunkless diff entry is a note, not a whole file", () => {
  expect(est(file({ status: "renamed" }))).toBe(90);
  expect(est(file({ status: "unchanged" }))).toBe(600);
});

test("a reviewed or over-large file is a collapsed header", () => {
  expect(est(file({ hunks: [hunk(10)] }), { reviewed: true })).toBe(44);
  expect(est(file({ hunks: [hunk(LARGE_FILE_LINES + 1)] }))).toBe(44);
});

// The gap bar carries the hunk's `@@` header, so a hunk is one metadata row and not two.
test("hunks cost one metadata row each plus the trailing gap", () => {
  expect(est(file({ hunks: [hunk(10), hunk(10)] }))).toBe((20 + 3) * 19 + 44);
});

test("open threads are counted, resolved ones barely", () => {
  const f = file({ hunks: [hunk(10)] });
  const base = est(f);
  expect(est(f, { comments: [comment({ resolved: true })] })).toBe(base + 40);
  expect(est(f, { comments: [comment({ replies: [{}, {}] as Comment[] })] })).toBe(base + 140 + 180);
});
