import { afterEach, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useJump } from "./useJump";
import type { Comment } from "./types";

const comment = (o: Partial<Comment>): Comment =>
  ({
    id: 1,
    reviewId: 1,
    filePath: "old.go",
    startLine: 3,
    endLine: 3,
    snippet: "",
    type: "bug",
    body: "",
    author: "reviewer",
    resolved: false,
    commitSha: "",
    side: "head",
    createdAt: "",
    updatedAt: "",
    replies: [],
    ...o,
  }) as Comment;

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function fileAnchor(path: string) {
  const el = document.createElement("div");
  el.id = `file-${path}`;
  document.body.appendChild(el);
  return el;
}

// Every card is keyed by effectivePath, so a comment the server relocated across a rename
// lives under currentFilePath. Naming the stored path would scroll to nothing and leave the
// expand signal matching no DiffView, so the thread would never mount and the poll would
// spin out silently.
test("jumping to a rename-moved comment targets the card at its current path", () => {
  const c = comment({ anchorStatus: "moved", currentFilePath: "new.go", currentStartLine: 5 });
  const { result } = renderHook(() => useJump({ comments: [c], setSelectedFile: () => {} }));
  const oldEl = fileAnchor("old.go");
  const newEl = fileAnchor("new.go");
  const oldScroll = vi.spyOn(oldEl, "scrollIntoView");
  const newScroll = vi.spyOn(newEl, "scrollIntoView");

  act(() => result.current.jumpTo(1));

  expect(newScroll).toHaveBeenCalled();
  expect(oldScroll).not.toHaveBeenCalled();
  expect(result.current.expandTarget?.path).toBe("new.go");

  act(() => result.current.resetJump());
});

// An unmoved comment still goes to its own path — effectivePath falls back to it.
test("jumping to a comment that hasn't moved targets its stored path", () => {
  const c = comment({});
  const { result } = renderHook(() => useJump({ comments: [c], setSelectedFile: () => {} }));
  const oldScroll = vi.spyOn(fileAnchor("old.go"), "scrollIntoView");

  act(() => result.current.jumpTo(1));

  expect(oldScroll).toHaveBeenCalled();
  expect(result.current.expandTarget?.path).toBe("old.go");

  act(() => result.current.resetJump());
});
