import { expect, test, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { CommentsPanel } from "./components/CommentsPanel";
import { NO_FILTER, type CommentFilter } from "./commentFilter";
import { clearDrafts, putDraft } from "./drafts";
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
      onJumpToDraft={() => {}}
      fileOrder={[]}
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

test("the filter pickers report the picked value", () => {
  const onFilterChange = vi.fn();
  panel(NO_FILTER, onFilterChange);
  fireEvent.click(screen.getByLabelText("Filter by status"));
  fireEvent.mouseDown(screen.getByRole("option", { name: "Resolved" }));
  expect(onFilterChange).toHaveBeenCalledWith({ ...NO_FILTER, status: "resolved" });
});

// Drafts sit above the list and answer to no filter: an unposted comment has no status, type
// filter or author yet, and hiding one would hide exactly what the section is for.
test("lists line, file and reply drafts above a filtered list, and jumps to one", () => {
  const onJumpToDraft = vi.fn();
  act(() => {
    putDraft({
      key: "line:3-5:a.go",
      target: { kind: "line", path: "a.go", startLine: 3, endLine: 5 },
      body: "half\na thought",
      type: "bug",
    });
    putDraft({ key: "reply:1", target: { kind: "reply", path: "a.go", commentId: 1 }, body: "ok", type: "general" });
    putDraft({ key: "edit:1", target: { kind: "edit", path: "a.go", commentId: 1 }, body: "x", type: "bug" });
  });
  render(
    <CommentsPanel
      comments={[]}
      total={1}
      awaitingYou={0}
      sort="file"
      onSortChange={() => {}}
      filter={{ ...NO_FILTER, query: "nothing matches" }}
      onFilterChange={() => {}}
      authors={["reviewer"]}
      onJump={() => {}}
      onJumpToDraft={onJumpToDraft}
      fileOrder={["b.go", "a.go"]}
      onDelete={() => {}}
      onCollapse={() => {}}
    />
  );

  const section = screen.getByRole("region", { name: "Unposted comments" });
  expect(section.textContent).toContain("Drafts (2)");
  expect(section.textContent).toContain("L3–5");
  expect(section.textContent).toContain("half a thought");
  expect(section.textContent).toContain("reply to #1");
  // An edit is marked on its comment's row, not listed as a draft.
  expect(section.textContent).not.toContain("edit of");

  fireEvent.click(screen.getByText("L3–5"));
  expect(onJumpToDraft).toHaveBeenCalledWith(expect.objectContaining({ key: "line:3-5:a.go" }));
  act(() => clearDrafts());
  expect(screen.queryByRole("region", { name: "Unposted comments" })).toBeNull();
});

// Grouped like the posted comments: a heading per file, in the file list's order, with a file's
// drafts top to bottom beneath it.
test("groups drafts under their file, in file order, top to bottom", () => {
  const line = (path: string, n: number) =>
    putDraft({
      key: `line:${n}-${n}:${path}`,
      target: { kind: "line", path, startLine: n, endLine: n },
      body: `${path}@${n}`,
      type: "general",
    });
  act(() => {
    line("a.go", 9);
    line("b.go", 1);
    line("a.go", 2);
    putDraft({ key: "file:a.go", target: { kind: "file", path: "a.go" }, body: "a.go@file", type: "general" });
  });
  const { container } = render(
    <CommentsPanel
      comments={[]}
      total={0}
      awaitingYou={0}
      sort="file"
      onSortChange={() => {}}
      filter={NO_FILTER}
      onFilterChange={() => {}}
      authors={[]}
      onJump={() => {}}
      onJumpToDraft={() => {}}
      fileOrder={["b.go", "a.go"]}
      onDelete={() => {}}
      onCollapse={() => {}}
    />
  );
  const groups = [...container.querySelectorAll(".draft-list .comment-file-group")];
  expect(groups.map((g) => g.querySelector(".comment-file-name")!.textContent)).toEqual(["b.go", "a.go"]);
  expect([...groups[1].querySelectorAll(".draft-preview")].map((p) => p.textContent)).toEqual([
    "a.go@file",
    "a.go@2",
    "a.go@9",
  ]);
  // The path heads the group, outside the draft's own box.
  expect(groups[1].querySelector(".draft-nav .comment-file-name")).toBeNull();
  act(() => clearDrafts());
});

test("a draft's cross discards it", () => {
  act(() =>
    putDraft({ key: "file:a.go", target: { kind: "file", path: "a.go" }, body: "gone soon", type: "general" })
  );
  panel(NO_FILTER);
  fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
  expect(screen.queryByText("gone soon")).toBeNull();
  expect(screen.queryByRole("region", { name: "Unposted comments" })).toBeNull();
});

test("a comment with an unsaved edit is marked editing", () => {
  act(() =>
    putDraft({ key: "edit:1", target: { kind: "edit", path: "a.go", commentId: 1 }, body: "x", type: "bug" })
  );
  panel(NO_FILTER);
  expect(screen.getByText("editing")).toBeTruthy();
  act(() => clearDrafts());
  expect(screen.queryByText("editing")).toBeNull();
});
