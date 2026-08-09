import { describe, expect, it } from "vitest";
import type { Hunk } from "./types";
import { gapView, hunkGaps } from "./hunkGaps";

const hunk = (header: string): Hunk => ({ header, lines: [] });

describe("hunkGaps", () => {
  it("finds the regions before, between and after the hunks", () => {
    const hunks = [hunk("@@ -10,4 +10,4 @@"), hunk("@@ -40,2 +40,2 @@")];
    expect(hunkGaps(hunks, 100)).toEqual([
      { hunkIndex: 0, start: 1, end: 9, delta: 0 },
      { hunkIndex: 1, start: 14, end: 39, delta: 0 },
      { hunkIndex: 2, start: 42, end: 100, delta: 0 },
    ]);
  });

  it("carries the old-side offset each region runs at", () => {
    // Three lines added at 10, so everything after sits three lines lower.
    const hunks = [hunk("@@ -10,2 +10,5 @@"), hunk("@@ -30,1 +33,1 @@")];
    const gaps = hunkGaps(hunks, 60);
    expect(gaps.map((g) => [g.start, g.end, g.delta])).toEqual([
      [1, 9, 0],
      [15, 32, -3],
      [34, 60, -3],
    ]);
  });

  it("omits a region the hunks leave no room for", () => {
    // A hunk starting at line 1 has nothing before it.
    expect(hunkGaps([hunk("@@ -1,3 +1,3 @@")], 3)).toEqual([]);
  });

  it("reads a hunk header that omits the count", () => {
    expect(hunkGaps([hunk("@@ -5 +5 @@")], 20)).toEqual([
      { hunkIndex: 0, start: 1, end: 4, delta: 0 },
      { hunkIndex: 1, start: 6, end: 20, delta: 0 },
    ]);
  });

  it("places a pure insertion, whose old side is empty", () => {
    // Two lines added after old line 4, so the new side runs two lines ahead.
    const gaps = hunkGaps([hunk("@@ -4,0 +5,2 @@")], 20);
    expect(gaps).toEqual([
      { hunkIndex: 0, start: 1, end: 4, delta: 0 },
      { hunkIndex: 1, start: 7, end: 20, delta: -2 },
    ]);
  });

  it("places a pure deletion, whose new side is empty", () => {
    // Old lines 5–7 deleted, so the new side runs three lines behind.
    const gaps = hunkGaps([hunk("@@ -5,3 +4,0 @@")], 20);
    expect(gaps).toEqual([
      { hunkIndex: 0, start: 1, end: 4, delta: 0 },
      { hunkIndex: 1, start: 5, end: 20, delta: 3 },
    ]);
  });

  it("clamps to the file it is given", () => {
    expect(hunkGaps([hunk("@@ -1,1 +1,1 @@")], 5)).toEqual([
      { hunkIndex: 1, start: 2, end: 5, delta: 0 },
    ]);
  });

  it("keeps the trailing context of a hunk out of the gap", () => {
    const gaps = hunkGaps([hunk("@@ -1,6 +1,6 @@")], 20);
    expect(gaps).toEqual([{ hunkIndex: 1, start: 7, end: 20, delta: 0 }]);
  });

  it("offers nothing when a header cannot be read", () => {
    expect(hunkGaps([hunk("@@ -10,4 +10,4 @@"), hunk("not a header")], 100)).toEqual([]);
  });

  it("offers nothing without hunks or a file to read them against", () => {
    expect(hunkGaps([], 100)).toEqual([]);
    expect(hunkGaps([hunk("@@ -10,4 +10,4 @@")], 0)).toEqual([]);
  });
});

describe("gapView", () => {
  const gap = { hunkIndex: 1, start: 10, end: 29, delta: 0 };

  it("hides the whole region until something is revealed", () => {
    expect(gapView(gap)).toEqual({ head: null, tail: null, hidden: 20 });
  });

  it("reveals from each end independently", () => {
    expect(gapView(gap, { head: 3, tail: 2 })).toEqual({
      head: { start: 10, end: 12 },
      tail: { start: 28, end: 29 },
      hidden: 15,
    });
  });

  it("never lets the two runs overlap", () => {
    expect(gapView(gap, { head: 18, tail: 9 })).toEqual({
      head: { start: 10, end: 27 },
      tail: { start: 28, end: 29 },
      hidden: 0,
    });
  });

  it("clamps a reveal past the end of the region", () => {
    expect(gapView(gap, { head: 999, tail: 0 })).toEqual({
      head: { start: 10, end: 29 },
      tail: null,
      hidden: 0,
    });
  });
});
