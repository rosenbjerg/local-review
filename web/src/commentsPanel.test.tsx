import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { CommentsPanel } from "./components/CommentsPanel";
import { NO_FILTER, type CommentFilter } from "./commentFilter";
import type { Comment } from "./types";

// The search is a controlled fourth filter axis: the pane never narrows the list
// itself (App does, so the n/p shortcuts step the same order), it only reports the
// query — and it marks matches with the same needle it reported.

const comment = (id: number, over: Partial<Comment> = {}): Comment =>
  ({
    id,
    filePath: "internal/api/side.go",
    startLine: 3,
    endLine: 3,
    type: "bug",
    author: "reviewer",
    body: "the anchor side is wrong here",
    resolved: false,
    replies: [],
    createdAt: "2026-08-31T10:00:00Z",
    updatedAt: "2026-08-31T10:00:00Z",
    ...over,
  }) as Comment;

function panel(filter: CommentFilter, onFilterChange = () => {}) {
  const comments = [comment(1)];
  return render(
    <CommentsPanel
      comments={comments}
      total={comments.length}
      awaitingYou={0}
      sort="file"
      onSortChange={() => {}}
      filter={filter}
      onFilterChange={onFilterChange}
      authors={["reviewer"]}
      onJump={() => {}}
      onDelete={() => {}}
      onCollapse={() => {}}
    />
  );
}

test("reports the typed query, leaving the narrowing to App", () => {
  const onFilterChange = vi.fn();
  panel(NO_FILTER, onFilterChange);
  fireEvent.change(screen.getByLabelText("Search comments"), { target: { value: "side" } });
  expect(onFilterChange).toHaveBeenCalledWith({ ...NO_FILTER, query: "side" });
});

test("marks the match in a file heading, case-insensitively", () => {
  const { container } = panel({ ...NO_FILTER, query: "API" });
  expect([...container.querySelectorAll("mark.search-hl")].map((m) => m.textContent)).toEqual([
    "api",
  ]);
});

test("marks nothing when the query is only whitespace", () => {
  const { container } = panel({ ...NO_FILTER, query: "  " });
  expect(container.querySelectorAll("mark.search-hl")).toHaveLength(0);
});

// A query counts as narrowing, so the shared Clear resets it along with the rest.
test("the filter Clear resets the query too", () => {
  const onFilterChange = vi.fn();
  panel({ ...NO_FILTER, query: "api" }, onFilterChange);
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(onFilterChange).toHaveBeenCalledWith(NO_FILTER);
});

// Escape is the dismiss gesture, and the global shortcut handler is a window
// listener (useKeyboardShortcuts) that would take the same key as "clear the
// occurrence highlight" — so it must not get this one.
test("Escape clears the query without reaching the window handler", () => {
  const onFilterChange = vi.fn();
  const onKeyDown = vi.fn();
  window.addEventListener("keydown", onKeyDown);
  try {
    panel({ ...NO_FILTER, query: "api" }, onFilterChange);
    fireEvent.keyDown(screen.getByLabelText("Search comments"), { key: "Escape" });
    expect(onFilterChange).toHaveBeenCalledWith({ ...NO_FILTER, query: "" });
    expect(onKeyDown).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("keydown", onKeyDown);
  }
});
