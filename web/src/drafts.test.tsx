import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";

// An unposted comment lives in the drafts store, not in the composer, so it outlives whatever
// unmounts the composer — a collapsed card or thread — and only a post or a cancel ends it.
vi.mock("./api", () => ({
  ApiError: class extends Error {},
  api: { file: vi.fn(async () => ({ path: "a.txt", ref: "r", content: "one\n", worktree: false })) },
}));
vi.mock("./highlight", () => ({
  langForPath: () => null,
  tokenize: vi.fn(async () => null),
  highlightBlocks: vi.fn(async () => null),
  langForInfo: () => null,
}));
vi.mock("./mermaid", () => ({ renderMermaid: vi.fn(async () => null) }));

import { CommentComposer } from "./components/CommentComposer";
import { CommentThread, type CommentActions } from "./components/CommentThread";
import { DiffView } from "./components/DiffView";
import { FileComments } from "./components/FileComments";
import {
  type DraftRef,
  clearDrafts,
  discardDraft,
  getDraft,
  getDrafts,
  putDraft,
  useLeaveWarning,
} from "./drafts";
import type { Comment, FileDiff } from "./types";

afterEach(() => act(() => clearDrafts()));

const ref: DraftRef = { key: "file:a.txt", target: { kind: "file", path: "a.txt" } };
const type = (value: string) => fireEvent.change(screen.getByRole("textbox"), { target: { value } });
const textbox = () => screen.getByRole("textbox") as HTMLTextAreaElement;

test("typing records a draft and a remounted composer picks it back up", () => {
  const first = render(<CommentComposer draft={ref} onSubmit={() => {}} onCancel={() => {}} />);
  type("half a thought");
  fireEvent.click(screen.getByRole("radio", { name: "bug" }));
  expect(getDraft(ref.key)).toMatchObject({ body: "half a thought", type: "bug" });
  first.unmount();

  render(<CommentComposer draft={ref} onSubmit={() => {}} onCancel={() => {}} />);
  expect(textbox().value).toBe("half a thought");
  expect(screen.getByRole("radio", { name: "bug" }).getAttribute("aria-checked")).toBe("true");
});

test("an open composer with nothing typed is not a draft", () => {
  render(<CommentComposer draft={ref} onSubmit={() => {}} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole("radio", { name: "bug" }));
  expect(getDrafts().size).toBe(0);
  type("x");
  type("   ");
  expect(getDrafts().size).toBe(0);
});

test("an edit is a draft only once it differs from what was saved", () => {
  const edit: DraftRef = { key: "edit:1", target: { kind: "edit", path: "a.txt", commentId: 1 } };
  render(<CommentComposer draft={edit} initialBody="saved" onSubmit={() => {}} onCancel={() => {}} />);
  expect(getDrafts().size).toBe(0);
  type("");
  expect(getDraft(edit.key)?.body).toBe("");
  type("saved");
  expect(getDrafts().size).toBe(0);
});

test("cancel discards the draft", () => {
  const onCancel = vi.fn();
  render(<CommentComposer draft={ref} onSubmit={() => {}} onCancel={onCancel} />);
  type("never mind");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalled();
  expect(getDrafts().size).toBe(0);
});

test("a post that lands ends the draft and one that fails keeps it", async () => {
  const onSubmit = vi.fn(async () => false);
  render(<CommentComposer draft={ref} onSubmit={onSubmit} onCancel={() => {}} />);
  type("try me");
  fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole("button", { name: "Add comment" })).toHaveProperty("disabled", false));
  expect(getDraft(ref.key)?.body).toBe("try me");

  onSubmit.mockResolvedValueOnce(true);
  fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
  await waitFor(() => expect(getDrafts().size).toBe(0));
});

// Dropping the draft re-renders the box at sync priority before the host's close lands.
test("a composer that posted never records its draft again, even re-rendered before it closes", async () => {
  const fresh = (): DraftRef => ({ key: "line:1-1:a.txt", target: { kind: "line", path: "a.txt", startLine: 1, endLine: 1 } });
  const { rerender } = render(<CommentComposer draft={fresh()} onSubmit={async () => true} onCancel={() => {}} />);
  type("posted");
  fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
  await waitFor(() => expect(getDrafts().size).toBe(0));

  rerender(<CommentComposer draft={fresh()} onSubmit={async () => true} onCancel={() => {}} />);
  expect(getDrafts().size).toBe(0);
});

test("a file comment's composer reopens on its draft", () => {
  const props = { path: "a.txt", comments: [], renderThread: () => null, onSubmit: async () => true };
  const first = render(<FileComments {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "+ Add file comment" }));
  type("about the file");
  first.unmount();

  render(<FileComments {...props} />);
  expect(textbox().value).toBe("about the file");
});

const lineFile: FileDiff = {
  oldPath: "a.txt",
  newPath: "a.txt",
  status: "modified",
  hunks: [
    {
      header: "@@ -1 +1,3 @@",
      lines: [
        { kind: "add", newLine: 1, content: "one" },
        { kind: "add", newLine: 2, content: "two" },
        { kind: "add", newLine: 3, content: "three" },
      ],
    },
  ],
};

function renderCard() {
  return render(
    <DiffView
      file={lineFile}
      repo="A"
      headRef="main"
      baseRef="base"
      side="head"
      comments={[]}
      onAddComment={async () => true}
      actions={{} as never}
      reviewed={false}
      onToggleReviewed={() => {}}
      expandTarget={null}
      expandComment={null}
      showFullSignal={null}
      activeComment={null}
      commentIds={new Set()}
    />
  );
}

const boxes = () =>
  screen.queryAllByPlaceholderText("Leave a comment for the agent…") as HTMLTextAreaElement[];

async function selectLine(container: HTMLElement, n: number) {
  await waitFor(() => expect(container.querySelectorAll(".gutter-click")).toHaveLength(3));
  fireEvent.mouseDown(container.querySelectorAll(".gutter-click")[n - 1]);
  fireEvent.mouseUp(window);
}

test("collapsing a card keeps its line comment's text", async () => {
  const { container } = renderCard();
  await selectLine(container, 1);
  fireEvent.change(boxes()[0], { target: { value: "line one is wrong" } });
  expect(getDraft("line:1-1:a.txt")?.target).toEqual({ kind: "line", path: "a.txt", startLine: 1, endLine: 1 });

  fireEvent.click(screen.getByTitle("Collapse file"));
  fireEvent.click(screen.getByTitle("Expand file"));
  expect(boxes().map((b) => b.value)).toEqual(["line one is wrong"]);
});

test("selecting another line opens a second draft instead of moving the first", async () => {
  const { container } = renderCard();
  await selectLine(container, 1);
  fireEvent.change(boxes()[0], { target: { value: "first" } });

  await selectLine(container, 3);
  expect(boxes().map((b) => b.value)).toEqual(["first", ""]);
  fireEvent.change(boxes()[1], { target: { value: "second" } });
  expect([...getDrafts().keys()].sort()).toEqual(["line:1-1:a.txt", "line:3-3:a.txt"]);

  // An empty selection moves freely; the drafts stay where they were written.
  await selectLine(container, 2);
  expect(boxes().map((b) => b.value)).toEqual(["first", "", "second"]);
  await selectLine(container, 1);
  expect(boxes().map((b) => b.value)).toEqual(["first", "second"]);
});

test("posting a line draft ends it, whether or not its box is the selection", async () => {
  const { container } = renderCard();
  await selectLine(container, 1);
  fireEvent.change(boxes()[0], { target: { value: "first" } });
  await selectLine(container, 3);
  fireEvent.change(boxes()[1], { target: { value: "second" } });

  // Line 3 is the selection; line 1 is a draft left behind.
  fireEvent.click(screen.getAllByRole("button", { name: "Add comment" })[1]);
  await waitFor(() => expect(boxes()).toHaveLength(1));
  expect([...getDrafts().keys()]).toEqual(["line:1-1:a.txt"]);

  fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
  await waitFor(() => expect(boxes()).toHaveLength(0));
  expect(getDrafts().size).toBe(0);
});

test("clearing a draft's text keeps its box open while it's being edited", async () => {
  const { container } = renderCard();
  await selectLine(container, 1);
  fireEvent.change(boxes()[0], { target: { value: "first" } });
  await selectLine(container, 3);

  fireEvent.focus(boxes()[0]);
  fireEvent.change(boxes()[0], { target: { value: "" } });
  expect(getDraft("line:1-1:a.txt")).toBeUndefined();
  expect(boxes()).toHaveLength(1);
});

test("collapsing a thread keeps a reply draft open, and drops an empty reply box", () => {
  const comment = {
    id: 7,
    filePath: "a.txt",
    startLine: 1,
    endLine: 1,
    body: "root",
    type: "general",
    author: "agent",
    resolved: false,
    replies: [],
    snippet: "",
    anchorStatus: "current",
  } as unknown as Comment;
  const actions = { onAddReply: vi.fn(async () => true) } as unknown as CommentActions;
  render(<CommentThread comment={comment} actions={actions} commentIds={new Set()} />);

  fireEvent.click(screen.getByRole("button", { name: "Reply" }));
  fireEvent.click(screen.getByTitle("Collapse thread"));
  fireEvent.click(screen.getAllByTitle("Expand thread")[0]);
  expect(screen.queryByPlaceholderText("Reply…")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Reply" }));
  fireEvent.change(screen.getByPlaceholderText("Reply…"), { target: { value: "on it" } });
  fireEvent.click(screen.getByTitle("Collapse thread"));
  fireEvent.click(screen.getAllByTitle("Expand thread")[0]);
  expect((screen.getByPlaceholderText("Reply…") as HTMLTextAreaElement).value).toBe("on it");
});

test("leaving the page asks first only while a draft exists", () => {
  renderHook(() => useLeaveWarning());
  const leave = () => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  };
  expect(leave()).toBe(false);
  act(() => putDraft({ ...ref, body: "unsent", type: "general" }));
  expect(leave()).toBe(true);
});

// Discarding from the panel has to close the box too: left open, it still holds the text and
// would put the draft back on its next render.
test("discarding a draft closes its box, the selection's included", async () => {
  const { container } = renderCard();
  await selectLine(container, 1);
  fireEvent.change(boxes()[0], { target: { value: "first" } });
  await selectLine(container, 3);
  fireEvent.change(boxes()[1], { target: { value: "second" } });

  act(() => discardDraft("line:1-1:a.txt"));
  expect(boxes().map((b) => b.value)).toEqual(["second"]);
  act(() => discardDraft("line:3-3:a.txt"));
  expect(boxes()).toHaveLength(0);
  expect(getDrafts().size).toBe(0);
});

test("discarding a file comment's draft closes its composer", () => {
  render(<FileComments path="a.txt" comments={[]} renderThread={() => null} onSubmit={async () => true} />);
  fireEvent.click(screen.getByRole("button", { name: "+ Add file comment" }));
  type("about the file");
  act(() => discardDraft("file:a.txt"));
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByRole("button", { name: "+ Add file comment" })).toBeTruthy();
});
