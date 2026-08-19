import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// DiffView renders the full-file source it fetches separately from the diff, and keys
// the add/context syntax tokens by new-side line number — so a source that no longer
// matches the hunks on screen shows the wrong text against the current line numbers.
// These cover the invalidation of that cached source.
vi.mock("./api", () => ({
  ApiError: class extends Error {
    constructor(
      m: string,
      readonly status: number
    ) {
      super(m);
    }
  },
  api: { file: vi.fn() },
}));
// No grammar: rows render raw text, so assertions read the DOM directly.
// highlightBlocks is stubbed too, since a rendered comment thread runs its body
// through Markdown, which chains it after markdown-it.
vi.mock("./highlight", () => ({
  langForPath: () => null,
  tokenize: vi.fn(async () => null),
  highlightBlocks: vi.fn(async () => null),
  langForInfo: () => null,
}));
vi.mock("./mermaid", () => ({ renderMermaid: vi.fn(async () => null) }));

import { api } from "./api";
import { DiffView } from "./components/DiffView";
import type { FileDiff } from "./types";

const props = {
  repo: "A",
  baseRef: "base",
  side: "head" as const,
  comments: [],
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

const content = (text: string, worktree = false) => ({
  path: "a.txt",
  ref: "r",
  content: `${text}\n`,
  worktree,
});

beforeEach(() => vi.clearAllMocks());

// A file the branch didn't touch, opened to comment on, is synthesized with no hunks
// and a fixed status/path — so a key built from those alone never moves, and the card
// (which lives entirely in Full view) kept showing the previous branch's text.
test("an unchanged-file card refetches its source when head switches", async () => {
  const unchanged = (): FileDiff => ({ oldPath: "a.txt", newPath: "a.txt", status: "unchanged", hunks: [] });
  vi.mocked(api.file).mockResolvedValue(content("ON-FEATURE"));

  const { rerender } = render(<DiffView {...props} file={unchanged()} headRef="feature" />);
  await waitFor(() => expect(screen.getByText("ON-FEATURE")).toBeTruthy());

  vi.mocked(api.file).mockResolvedValue(content("ON-OTHER"));
  rerender(<DiffView {...props} file={unchanged()} headRef="other" />);

  await waitFor(() => expect(screen.getByText("ON-OTHER")).toBeTruthy());
  expect(screen.queryByText("ON-FEATURE")).toBeNull();
});

// Same key, same hole, reached by switching repos: two repos can hold the same path.
test("an unchanged-file card refetches its source when the repo switches", async () => {
  const unchanged = (): FileDiff => ({ oldPath: "a.txt", newPath: "a.txt", status: "unchanged", hunks: [] });
  vi.mocked(api.file).mockResolvedValue(content("IN-REPO-A"));

  const { rerender } = render(<DiffView {...props} file={unchanged()} headRef="main" repo="A" />);
  await waitFor(() => expect(screen.getByText("IN-REPO-A")).toBeTruthy());

  vi.mocked(api.file).mockResolvedValue(content("IN-REPO-B"));
  rerender(<DiffView {...props} file={unchanged()} headRef="main" repo="B" />);

  await waitFor(() => expect(screen.getByText("IN-REPO-B")).toBeTruthy());
});

// A ref read the ref couldn't satisfy is served from disk. The hunks still come from
// the ref, so that text may not match them — say so rather than let it read as the
// ref's content, which is the same wrong-lines confusion with no visible cause.
test("a working-tree substitution is labelled, an honest ref read is not", async () => {
  const file = (): FileDiff => ({ oldPath: "a.txt", newPath: "a.txt", status: "unchanged", hunks: [] });
  vi.mocked(api.file).mockResolvedValue(content("UNCOMMITTED", true));

  const { rerender } = render(<DiffView {...props} file={file()} headRef="main" />);
  await waitFor(() => expect(screen.getByText(/showing the working-tree copy/)).toBeTruthy());

  // The same content served from the ref it was asked for carries no note.
  vi.mocked(api.file).mockResolvedValue(content("COMMITTED", false));
  rerender(<DiffView {...props} file={file()} headRef="other" />);
  await waitFor(() => expect(screen.getByText("COMMITTED")).toBeTruthy());
  expect(screen.queryByText(/showing the working-tree copy/)).toBeNull();
});

// Asking for the working tree and getting it is not a substitution — the note is for
// the surprise, so it must not fire on the side the card requested.
test("an explicit working-tree read is not labelled a substitution", async () => {
  const file = (): FileDiff => ({ oldPath: "a.txt", newPath: "a.txt", status: "unchanged", hunks: [] });
  vi.mocked(api.file).mockResolvedValue(content("ON-DISK", true));

  render(<DiffView {...props} file={file()} headRef="main" side="worktree" />);
  await waitFor(() => expect(screen.getByText("ON-DISK")).toBeTruthy());
  expect(screen.queryByText(/showing the working-tree copy/)).toBeNull();
});

// The source cache still has to survive a diff refetch that changed nothing, or every
// live-sync ping would refetch (and flash) every expanded file in the review.
test("a diff refetch with identical hunks keeps the cached source", async () => {
  const file = (): FileDiff => ({
    oldPath: "a.txt",
    newPath: "a.txt",
    status: "modified",
    hunks: [{ header: "@@ -1 +1 @@", lines: [{ kind: "add", newLine: 1, content: "SAME" }] }],
  });
  vi.mocked(api.file).mockResolvedValue(content("SAME"));

  const { rerender } = render(<DiffView {...props} file={file()} headRef="main" />);
  await waitFor(() => expect(vi.mocked(api.file).mock.calls.length).toBe(1));

  rerender(<DiffView {...props} file={file()} headRef="main" />); // new object, same content
  await new Promise((r) => setTimeout(r, 0));
  expect(vi.mocked(api.file).mock.calls.length).toBe(1);
});

// The word-diff ranges are computed from the hunks but painted onto the rendered
// rows, so the two can drift apart independently of wordDiff.ts being correct.
test("a paired -/+ line marks only the words that changed", async () => {
  const file = (): FileDiff => ({
    oldPath: "a.txt",
    newPath: "a.txt",
    status: "modified",
    hunks: [
      {
        header: "@@ -1 +1 @@",
        lines: [
          { kind: "del", oldLine: 1, content: "const total = price * quantity;" },
          { kind: "add", newLine: 1, content: "const total = price * amount;" },
        ],
      },
    ],
  });
  vi.mocked(api.file).mockResolvedValue(content("const total = price * amount;"));

  const { container } = render(<DiffView {...props} file={file()} headRef="main" />);
  await waitFor(() => expect(container.querySelectorAll(".word-diff").length).toBeGreaterThan(0));

  const marked = [...container.querySelectorAll(".word-diff")].map((el) => el.textContent);
  expect(marked).toEqual(["quantity", "amount"]);
  // The rest of the line is still rendered, just unmarked.
  expect(container.querySelector(".row-add")?.textContent).toContain("const total = price *");
});

// The expanders read the hidden lines out of the full file the card already
// fetched, and place them against the hunks — the same source/hunks pairing the
// tests above guard, so a gap misplaced by one prints the wrong text at a line.
const numbered = (n: number) => Array.from({ length: n }, (_, i) => `L${i + 1}`).join("\n");

const modifiedAt = (line: number): FileDiff => ({
  oldPath: "a.txt",
  newPath: "a.txt",
  status: "modified",
  hunks: [
    {
      header: `@@ -${line} +${line} @@`,
      lines: [
        { kind: "del", oldLine: line, content: "gone" },
        { kind: "add", newLine: line, content: `L${line}` },
      ],
    },
  ],
});

test("a hidden region expands a step at a time, from the end nearest its hunk", async () => {
  vi.mocked(api.file).mockResolvedValue(content(numbered(100)));

  render(<DiffView {...props} file={modifiedAt(40)} headRef="main" />);
  await waitFor(() => expect(screen.getByText("Show all 39 hidden lines")).toBeTruthy());
  expect(screen.queryByText("L39")).toBeNull();

  // The region above the hunk can only grow downward — the file's top edge is the
  // other side of it, so it offers one direction.
  expect(screen.queryByLabelText("Show 20 more lines above")).toBeTruthy(); // the region below
  fireEvent.click(screen.getByLabelText("Show 20 more lines below"));

  expect(screen.getByText("L39")).toBeTruthy(); // revealed up against the hunk
  expect(screen.queryByText("L19")).toBeNull(); // still hidden, further from it
  expect(screen.getByText("Show all 19 hidden lines")).toBeTruthy();
});

test("a fully revealed region drops its bar and the hunk header with it", async () => {
  vi.mocked(api.file).mockResolvedValue(content(numbered(30)));

  render(<DiffView {...props} file={modifiedAt(5)} headRef="main" />);
  await waitFor(() => expect(screen.getByText("Show all 4 hidden lines")).toBeTruthy());
  expect(screen.getByText("@@ -5 +5 @@")).toBeTruthy();

  fireEvent.click(screen.getByText("Show all 4 hidden lines"));

  expect(screen.getByText("L1")).toBeTruthy();
  // The lines now run continuously into the hunk, so the header says nothing.
  expect(screen.queryByText("@@ -5 +5 @@")).toBeNull();
});

test("a revealed line carries the old-side number its region runs at", async () => {
  const added: FileDiff = {
    oldPath: "a.txt",
    newPath: "a.txt",
    status: "modified",
    hunks: [
      {
        header: "@@ -9,0 +10,3 @@",
        lines: [
          { kind: "add", newLine: 10, content: "L10" },
          { kind: "add", newLine: 11, content: "L11" },
          { kind: "add", newLine: 12, content: "L12" },
        ],
      },
    ],
  };
  vi.mocked(api.file).mockResolvedValue(content(numbered(100)));

  const { container } = render(<DiffView {...props} file={added} headRef="main" />);
  await waitFor(() => expect(screen.getByLabelText("Show 20 more lines above")).toBeTruthy());
  fireEvent.click(screen.getByLabelText("Show 20 more lines above"));

  const row = [...container.querySelectorAll("tr")].find(
    (tr) => tr.querySelector(".line-content")?.textContent?.trim() === "L13"
  );
  const gutters = row?.querySelectorAll(".gutter");
  // Three lines were added above, so the new side runs three ahead of the old.
  expect(gutters?.[0].textContent).toBe("10");
  expect(gutters?.[1].textContent).toBe("13");
});

// Two lines that merely sit next to each other in a hunk aren't an edit of one
// another; marking their few shared tokens would be worse than marking nothing.
test("an unrelated -/+ pair is left unmarked", async () => {
  const file = (): FileDiff => ({
    oldPath: "a.txt",
    newPath: "a.txt",
    status: "modified",
    hunks: [
      {
        header: "@@ -1 +1 @@",
        lines: [
          { kind: "del", oldLine: 1, content: "    return err" },
          { kind: "add", newLine: 1, content: "    logger.debug(payload, ctx)" },
        ],
      },
    ],
  });
  vi.mocked(api.file).mockResolvedValue(content("    logger.debug(payload, ctx)"));

  const { container } = render(<DiffView {...props} file={file()} headRef="main" />);
  await waitFor(() => expect(screen.getAllByText(/logger\.debug/).length).toBeGreaterThan(0));
  expect(container.querySelectorAll(".word-diff").length).toBe(0);
});

// A file the diff *did* touch can carry no hunks at all — a pure rename, a mode-only
// change, an empty added file — and Changed view builds its rows from the hunks, so
// the card came out blank: a file counted in the review with nothing to show for it.
test("a hunkless changed file says why its card is empty", async () => {
  vi.mocked(api.file).mockResolvedValue(content("x"));
  const renamed: FileDiff = { oldPath: "old.txt", newPath: "new.txt", status: "renamed", hunks: [] };

  render(<DiffView {...props} file={renamed} headRef="feature" />);

  await waitFor(() => expect(screen.getByText("Renamed with no content changes.")).toBeTruthy());
});

// The synthetic card for a file opened only to comment on is hunkless too, but it
// lives in Full view and renders the whole file — nothing to explain there.
test("a file opened only to comment on gets no empty-card note", async () => {
  vi.mocked(api.file).mockResolvedValue(content("WHOLE-FILE"));
  const opened: FileDiff = { oldPath: "a.txt", newPath: "a.txt", status: "unchanged", hunks: [] };

  render(<DiffView {...props} file={opened} headRef="feature" />);

  await waitFor(() => expect(screen.getByText("WHOLE-FILE")).toBeTruthy());
  expect(screen.queryByText(/no content changes/i)).toBeNull();
});

// Line commenting anchors to the new side, so a deleted file — every row a deletion,
// with no new-side line to click — had no way to take a comment at all. Reviewing a
// deletion is ordinary ("why did this go?"), and the file-level anchor the store,
// API and export already support was reachable only from the media and markdown
// views. Both gaps are the one missing surface.
test("a deleted file can take a file-level comment", async () => {
  const deleted: FileDiff = {
    oldPath: "gone.txt",
    newPath: "",
    status: "deleted",
    hunks: [
      {
        header: "@@ -1,2 +0,0 @@",
        lines: [
          { kind: "del", oldLine: 1, content: "one" },
          { kind: "del", oldLine: 2, content: "two" },
        ],
      },
    ],
  };
  const onAddComment = vi.fn(async () => true);
  render(<DiffView {...props} file={deleted} headRef="feature" onAddComment={onAddComment} />);

  fireEvent.click(screen.getByText("+ Add file comment"));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "why was this removed?" } });
  fireEvent.click(screen.getByRole("button", { name: "Add comment" }));

  await waitFor(() => expect(onAddComment).toHaveBeenCalled());
  expect(onAddComment.mock.calls[0][0]).toMatchObject({
    // The old path: a deleted file has no new side to name it by.
    filePath: "gone.txt",
    startLine: 0,
    endLine: 0,
  });
});

// The same surface is what lets any source file carry a remark about itself, rather
// than forcing it onto an arbitrary line.
test("a source file can take a file-level comment", async () => {
  const modified: FileDiff = {
    oldPath: "a.txt",
    newPath: "a.txt",
    status: "modified",
    hunks: [{ header: "@@ -1 +1 @@", lines: [{ kind: "add", newLine: 1, content: "x" }] }],
  };
  vi.mocked(api.file).mockResolvedValue(content("x"));
  const onAddComment = vi.fn(async () => true);
  render(<DiffView {...props} file={modified} headRef="feature" onAddComment={onAddComment} />);

  fireEvent.click(screen.getByText("+ Add file comment"));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "this file should not exist" } });
  fireEvent.click(screen.getByRole("button", { name: "Add comment" }));

  await waitFor(() => expect(onAddComment).toHaveBeenCalled());
  expect(onAddComment.mock.calls[0][0]).toMatchObject({ filePath: "a.txt", startLine: 0, endLine: 0 });
});

// A line-0 comment belongs to the file, so it renders in the file block below the
// table — not in the leftover bucket, which is for comments whose *line* isn't on
// screen. Keeping them apart is what stops a file remark from reading as a stranded
// line comment.
test("existing file-level comments render below the table, not as leftovers", async () => {
  const modified: FileDiff = {
    oldPath: "a.txt",
    newPath: "a.txt",
    status: "modified",
    hunks: [{ header: "@@ -1 +1 @@", lines: [{ kind: "add", newLine: 1, content: "x" }] }],
  };
  const fileComment = {
    id: 7,
    reviewId: 1,
    filePath: "a.txt",
    startLine: 0,
    endLine: 0,
    snippet: "",
    type: "bug" as const,
    body: "whole-file remark",
    author: "reviewer",
    resolved: false,
    commitSha: "",
    worktree: false,
    createdAt: "",
    updatedAt: "",
    replies: [],
  };
  vi.mocked(api.file).mockResolvedValue(content("x"));
  render(
    <DiffView
      {...props}
      file={modified}
      headRef="feature"
      comments={[fileComment]}
      actions={{ onEdit: vi.fn(), onDelete: vi.fn(), onReply: vi.fn(), onResolve: vi.fn() } as never}
    />
  );

  const body = await screen.findByText("whole-file remark");
  expect(body.closest(".file-comments")).not.toBeNull();
  expect(body.closest("table")).toBeNull();
});
