import { beforeEach, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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
vi.mock("./highlight", () => ({ langForPath: () => null, tokenize: vi.fn(async () => null) }));

import { api } from "./api";
import { DiffView } from "./components/DiffView";
import type { FileDiff } from "./types";

const props = {
  repo: "A",
  baseRef: "base",
  worktree: false,
  indexed: false,
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

  render(<DiffView {...props} file={file()} headRef="main" worktree={true} />);
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
