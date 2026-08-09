import { describe, expect, it } from "vitest";
import type { FileDiff } from "./types";
import { fileStat, isEmptyStat, totalStat } from "./diffStats";

const file = (over: Partial<FileDiff> = {}): FileDiff => ({
  oldPath: "a.txt",
  newPath: "a.txt",
  status: "modified",
  hunks: [],
  ...over,
});

const changed = file({
  hunks: [
    {
      header: "@@ -1,2 +1,3 @@",
      lines: [
        { kind: "context", oldLine: 1, newLine: 1, content: "kept" },
        { kind: "del", oldLine: 2, content: "gone" },
        { kind: "add", newLine: 2, content: "new" },
        { kind: "add", newLine: 3, content: "also new" },
      ],
    },
  ],
});

describe("fileStat", () => {
  it("counts added and removed lines, ignoring context", () => {
    expect(fileStat(changed)).toEqual({ added: 2, removed: 1 });
  });

  it("counts nothing for a file with no hunks", () => {
    // A binary file, or one opened only to comment on.
    expect(fileStat(file({ binary: true }))).toEqual({ added: 0, removed: 0 });
    expect(fileStat(file({ status: "unchanged" }))).toEqual({ added: 0, removed: 0 });
  });
});

describe("totalStat", () => {
  it("sums the files it is given", () => {
    expect(totalStat([changed, changed, file()])).toEqual({ added: 4, removed: 2 });
  });

  it("is empty for an empty review", () => {
    expect(isEmptyStat(totalStat([]))).toBe(true);
  });
});
