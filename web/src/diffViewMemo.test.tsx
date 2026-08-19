import { expect, test, vi } from "vitest";
import { render } from "@testing-library/react";

// File cards mount once and never unmount, so every mounted card sits in App's
// render output forever. Without a memo boundary they all re-render whenever
// anything in App changes — and each rebuilds every row and a style object per
// syntax token, so the cost of one comment landing grows with how many files the
// reviewer has scrolled past. These pin the boundary and the one prop it has to
// compare by value.
vi.mock("./api", () => ({
  ApiError: class extends Error {},
  api: { file: vi.fn(async () => ({ path: "a.txt", ref: "r", content: "x\n", worktree: false })) },
}));
vi.mock("./highlight", () => ({
  langForPath: () => null,
  langForInfo: () => null,
  tokenize: vi.fn(async () => null),
  highlightBlocks: vi.fn(async () => null),
}));
vi.mock("./mermaid", () => ({ renderMermaid: vi.fn(async () => null) }));

// The header renders on every card render, so it doubles as the render counter.
let headerRenders = 0;
vi.mock("./components/FileHeader", () => ({
  FileHeader: ({ path }: { path: string }) => {
    headerRenders++;
    return <div>{path}</div>;
  },
}));

import { DiffView } from "./components/DiffView";
import type { Comment, FileDiff } from "./types";

const file: FileDiff = {
  oldPath: "a.txt",
  newPath: "a.txt",
  status: "modified",
  hunks: [{ header: "@@ -1 +1 @@", lines: [{ kind: "add", newLine: 1, content: "x" }] }],
};

const comment = (body: string): Comment => ({
  id: 1,
  reviewId: 1,
  filePath: "a.txt",
  startLine: 1,
  endLine: 1,
  type: "suggestion",
  body,
  snippet: "x",
  author: "reviewer",
  createdAt: "",
  updatedAt: "",
});

const props = {
  file,
  repo: "A",
  headRef: "main",
  baseRef: "base",
  side: "head" as const,
  onAddComment: async () => true,
  actions: {} as never,
  reviewed: false,
  onToggleReviewed: () => {},
  expandTarget: null,
  expandComment: null,
  showFullSignal: null,
  activeComment: null,
  commentIds: new Set<number>(),
};

// Every review read rebuilds the comment list from JSON, so a card's comments prop
// is a new array each time even when nothing about that file changed. Identity
// comparison alone would therefore never bail out.
test("a card doesn't re-render for a comment array that only changed identity", () => {
  headerRenders = 0;
  const { rerender } = render(<DiffView {...props} comments={[comment("same")]} />);
  const after = headerRenders;

  rerender(<DiffView {...props} comments={[comment("same")]} />);

  expect(headerRenders).toBe(after);
});

test("a card re-renders when one of its comments actually changed", () => {
  headerRenders = 0;
  const { rerender } = render(<DiffView {...props} comments={[comment("first")]} />);
  const after = headerRenders;

  rerender(<DiffView {...props} comments={[comment("edited")]} />);

  expect(headerRenders).toBeGreaterThan(after);
});

// The comparator skips only `comments`; everything else still has to propagate, or
// a toggle would leave the card showing the previous side.
test("a card re-renders when a non-comment prop changes", () => {
  headerRenders = 0;
  const comments = [comment("same")];
  const { rerender } = render(<DiffView {...props} comments={comments} />);
  const after = headerRenders;

  rerender(<DiffView {...props} comments={comments} side="worktree" />);

  expect(headerRenders).toBeGreaterThan(after);
});
