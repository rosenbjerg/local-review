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

const content = (text: string) => ({ path: "a.txt", ref: "r", content: `${text}\n` });

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
