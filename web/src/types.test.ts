import { expect, test } from "vitest";
import type { Comment } from "./types";
import { effectiveLines, effectivePath, lineLabel } from "./types";

// Minimal Comment factory (this file is excluded from the build tsconfig).
const c = (o: Partial<Comment>): Comment =>
  ({
    id: 1,
    reviewId: 1,
    filePath: "a.go",
    startLine: 3,
    endLine: 3,
    snippet: "",
    type: "bug",
    body: "",
    author: "reviewer",
    resolved: false,
    commitSha: "",
    worktree: false,
    createdAt: "",
    updatedAt: "",
    replies: [],
    ...o,
  }) as Comment;

test("effectivePath uses currentFilePath only for a rename-followed move", () => {
  expect(effectivePath(c({ anchorStatus: "moved", currentFilePath: "b.go" }))).toBe("b.go");
  // moved within the same file (no currentFilePath) → original path
  expect(effectivePath(c({ anchorStatus: "moved" }))).toBe("a.go");
  // currentFilePath is ignored unless the status is moved
  expect(effectivePath(c({ anchorStatus: "outdated", currentFilePath: "b.go" }))).toBe("a.go");
  expect(effectivePath(c({ anchorStatus: "current" }))).toBe("a.go");
  expect(effectivePath(c({}))).toBe("a.go");
});

test("effectiveLines uses the relocated range only when moved", () => {
  expect(effectiveLines(c({ anchorStatus: "moved", currentStartLine: 5, currentEndLine: 7 }))).toEqual({
    start: 5,
    end: 7,
  });
  // currentEndLine falls back to currentStartLine
  expect(effectiveLines(c({ anchorStatus: "moved", currentStartLine: 5 }))).toEqual({ start: 5, end: 5 });
  // moved but no relocated line → original range
  expect(effectiveLines(c({ anchorStatus: "moved", startLine: 2, endLine: 4 }))).toEqual({
    start: 2,
    end: 4,
  });
  expect(effectiveLines(c({ anchorStatus: "outdated", startLine: 2, endLine: 4 }))).toEqual({
    start: 2,
    end: 4,
  });
});

test("lineLabel renders a single line or a range off the effective lines", () => {
  expect(lineLabel(c({ startLine: 3, endLine: 3 }))).toBe("L3");
  expect(lineLabel(c({ startLine: 2, endLine: 4 }))).toBe("L2–4"); // en-dash
  expect(lineLabel(c({ anchorStatus: "moved", currentStartLine: 5, currentEndLine: 7 }))).toBe("L5–7");
});
