import { describe, expect, test } from "vitest";
import { mergeFiles } from "./mergeFiles";
import type { FileDiff } from "./types";

const file = (path: string, content = "x"): FileDiff => ({
  oldPath: path,
  newPath: path,
  status: "modified",
  hunks: [{ header: "@@ -1 +1 @@", lines: [{ kind: "add", newLine: 1, content }] }],
});

// A refetch always parses fresh JSON, so this is what every ping actually hands the merge.
const reparse = (files: FileDiff[]): FileDiff[] => JSON.parse(JSON.stringify(files));

describe("mergeFiles", () => {
  // The poller fires on mtime, so most `diff` pings rebuild a diff that didn't move. Without this
  // the whole diff re-renders and every mounted card re-runs Shiki — 87ms for a 579-line file.
  test("an unchanged diff keeps the array and every file", () => {
    const prev = [file("a.ts"), file("b.ts")];
    const next = mergeFiles(prev, reparse(prev));
    expect(next).toBe(prev);
  });

  test("one changed file leaves the others' identity alone", () => {
    const prev = [file("a.ts"), file("b.ts"), file("c.ts")];
    const incoming = reparse(prev);
    incoming[1] = file("b.ts", "edited");
    const next = mergeFiles(prev, incoming);

    expect(next).not.toBe(prev);
    expect(next[0]).toBe(prev[0]);
    expect(next[1]).not.toBe(prev[1]);
    expect(next[1].hunks[0].lines[0].content).toBe("edited");
    expect(next[2]).toBe(prev[2]);
  });

  test("an added file keeps the existing ones", () => {
    const prev = [file("a.ts")];
    const next = mergeFiles(prev, [...reparse(prev), file("b.ts")]);
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(prev[0]);
  });

  test("a removed file keeps the survivors", () => {
    const prev = [file("a.ts"), file("b.ts")];
    const next = mergeFiles(prev, reparse([prev[1]]));
    expect(next).toEqual([prev[1]]);
    expect(next[0]).toBe(prev[1]);
  });

  test("a reordered diff reuses the files but not the array", () => {
    const prev = [file("a.ts"), file("b.ts")];
    const next = mergeFiles(prev, reparse([prev[1], prev[0]]));
    expect(next).not.toBe(prev);
    expect(next[0]).toBe(prev[1]);
    expect(next[1]).toBe(prev[0]);
  });

  // Keying on newPath alone would hand the rename the old file's object, whose hunks describe
  // a different pair of blobs — and whose identity would then suppress the card's refetch.
  test("a rename onto a path another file vacated is not paired with it", () => {
    const moved: FileDiff = { ...file("b.ts"), oldPath: "a.ts", status: "renamed" };
    const prev = [file("b.ts")];
    const next = mergeFiles(prev, reparse([moved]));
    expect(next[0]).not.toBe(prev[0]);
    expect(next[0].oldPath).toBe("a.ts");
  });

  test("the first diff of a review passes straight through", () => {
    const incoming = [file("a.ts")];
    expect(mergeFiles([], incoming)).toBe(incoming);
  });
});
