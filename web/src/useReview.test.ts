import { beforeEach, expect, test, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// Mock the API layer; each test configures the git-shaped responses it needs. The
// factory can't reference outer variables (it's hoisted), so defaults are inline and
// re-established in beforeEach.
vi.mock("./api", () => {
  let reviewId = 0;
  const mkReview = (repo: string, head: string, base?: string) => ({
    id: ++reviewId,
    repoPath: repo,
    baseRef: base && base !== "" ? base : "main",
    headRef: head,
    headSha: "sha",
    status: "draft",
    createdAt: "",
    updatedAt: "",
    comments: [],
    reviewedFiles: [],
  });
  return {
    api: {
      repos: vi.fn(),
      branches: vi.fn(),
      commits: vi.fn(),
      diff: vi.fn(),
      createReview: vi.fn(async (repo: string, head: string, base?: string) => mkReview(repo, head, base)),
      getReview: vi.fn(async (id: number) => ({ ...mkReview("repo", "main", "main"), id })),
      setReviewed: vi.fn(async () => {}),
      resetReview: vi.fn(async () => {}),
    },
  };
});

import { api } from "./api";
import { useReview } from "./useReview";

const branch = (name: string, o: { current?: boolean; main?: boolean; remote?: boolean } = {}) => ({
  name,
  isCurrent: !!o.current,
  isMain: !!o.main,
  isRemote: !!o.remote,
});
const mainOnly = { main: "main", branches: [branch("main", { current: true, main: true })] };

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(api.repos).mockResolvedValue({ repos: ["A", "B"] });
  vi.mocked(api.branches).mockResolvedValue(mainOnly);
  vi.mocked(api.commits).mockResolvedValue({ commits: [] });
  vi.mocked(api.diff).mockResolvedValue({ base: "base", head: "head", files: [] });
});

// Regression for the empty-head-branch-list race (commit ef7942f): switching repos
// must not leave the branch picker empty. The old-repo head is still set during the
// switch render, and if changeRepo didn't clear it the auto-start effect would fire
// startReview() with that stale head, bumping the shared reqSeq and discarding the
// in-flight branch fetch. Both repos have `main`, the case that actually triggered it.
test("switching repos keeps the head-branch list populated", async () => {
  const { result } = renderHook(() => useReview());
  await waitFor(() => expect(result.current.repo).toBe("A"));
  await waitFor(() => expect(result.current.branches.map((b) => b.name)).toContain("main"));
  expect(result.current.head).toBe("main");

  act(() => result.current.changeRepo("B"));
  await waitFor(() => expect(result.current.repo).toBe("B"));

  await waitFor(() => expect(result.current.branches.map((b) => b.name)).toContain("main"));
  expect(result.current.head).toBe("main");
});

// Regression for the head-switch/from race: changeHead must reset `from` to "all" in
// the same update, or the picked (old-head) commit would drive a cross-branch diff.
test("changing head resets the 'from' picker to all", async () => {
  vi.mocked(api.branches).mockResolvedValue({
    main: "main",
    branches: [branch("main", { current: true, main: true }), branch("feature")],
  });
  const { result } = renderHook(() => useReview());
  await waitFor(() => expect(result.current.head).toBe("main"));

  act(() => result.current.setFrom("abc123"));
  expect(result.current.from).toBe("abc123");

  act(() => result.current.changeHead("feature"));
  expect(result.current.head).toBe("feature");
  expect(result.current.from).toBe("all");
});

// worktreeSide/indexedSide are the anchor side sent with comments/reviewed marks; they
// must derive from uncommitted + unstaged (and be mutually exclusive) when head is the
// checked-out branch.
test("worktreeSide / indexedSide derive from uncommitted + unstaged", async () => {
  const { result } = renderHook(() => useReview());
  await waitFor(() => expect(result.current.head).toBe("main")); // headIsCurrent

  expect(result.current.worktreeSide).toBe(false);
  expect(result.current.indexedSide).toBe(false);

  act(() => result.current.setUncommitted(true));
  expect(result.current.worktreeSide).toBe(true); // uncommitted + unstaged(default) → working tree
  expect(result.current.indexedSide).toBe(false);

  act(() => result.current.setUnstaged(false));
  expect(result.current.worktreeSide).toBe(false);
  expect(result.current.indexedSide).toBe(true); // uncommitted + !unstaged → git index
});

// Regression for the stale 'from' after an out-of-band rebase (commit 464d949): an SSE
// `diff` ping refetches commits, and a picked `from` whose sha is gone resets to "all"
// (else the next diff would 400 on an unknown revision).
test("an SSE diff ping resets a 'from' whose commit was rebased away", async () => {
  vi.mocked(api.commits).mockResolvedValue({
    commits: [
      { sha: "c2", shortSha: "c2", subject: "b", relDate: "" },
      { sha: "c1", shortSha: "c1", subject: "a", relDate: "" },
    ],
  });
  const { result } = renderHook(() => useReview());
  await waitFor(() => expect(result.current.review).not.toBeNull()); // SSE now subscribed

  act(() => result.current.setFrom("c2"));
  expect(result.current.from).toBe("c2");

  // The branch is rebased: the next commit refetch no longer contains c2.
  vi.mocked(api.commits).mockResolvedValue({
    commits: [{ sha: "c3", shortSha: "c3", subject: "c", relDate: "" }],
  });
  const es = (globalThis as unknown as { EventSource: { instances: { onmessage: ((e: { data: string }) => void) | null }[] } }).EventSource.instances.at(-1);
  await act(async () => {
    es?.onmessage?.({ data: "diff" });
  });

  await waitFor(() => expect(result.current.from).toBe("all"));
});

// The frontend→backend contract: each view-axis combination must map to the right
// api.diff params, or the backend computes the wrong diff scope.
test("diffOpts maps the view axes to the api.diff params", async () => {
  const { result } = renderHook(() => useReview());
  await waitFor(() => expect(result.current.review).not.toBeNull());
  const lastOpts = () => vi.mocked(api.diff).mock.calls.at(-1)?.[2] as Record<string, unknown> | undefined;

  // branch scope (whole branch, committed): from "all", base carried, not uncommitted
  await waitFor(() =>
    expect(lastOpts()).toMatchObject({ from: "all", base: "main", uncommitted: false, unstaged: true })
  );

  act(() => result.current.setUncommitted(true)); // working tree (staged + unstaged)
  await waitFor(() => expect(lastOpts()).toMatchObject({ from: "all", uncommitted: true, unstaged: true }));

  act(() => result.current.setUnstaged(false)); // staged only → git index
  await waitFor(() => expect(lastOpts()).toMatchObject({ uncommitted: true, unstaged: false }));

  act(() => result.current.setFrom("c1")); // since a commit → base dropped
  await waitFor(() => {
    const o = lastOpts();
    expect(o).toMatchObject({ from: "c1", uncommitted: true, unstaged: false });
    expect(o?.base).toBeUndefined();
  });
});

// The uncommitted axis is only meaningful for the checked-out branch, so it must turn
// itself off (and its side flags clear) when head isn't current.
test("uncommitted turns off when head isn't the checked-out branch", async () => {
  vi.mocked(api.branches).mockResolvedValue({
    main: "main",
    branches: [branch("main", { current: true, main: true }), branch("feature")],
  });
  const { result } = renderHook(() => useReview());
  await waitFor(() => expect(result.current.head).toBe("main"));

  act(() => result.current.changeHead("feature")); // head=feature, current=main → not current
  await waitFor(() => expect(result.current.headIsCurrent).toBe(false));

  act(() => result.current.setUncommitted(true));
  await waitFor(() => expect(result.current.uncommitted).toBe(false)); // guard turns it back off
  expect(result.current.worktreeSide).toBe(false);
  expect(result.current.indexedSide).toBe(false);
});

// The shared reqSeq guard: a slow diff response for a selection the user has already
// moved past must be discarded, not applied over the newer result.
test("a superseded (slow) diff response is discarded", async () => {
  const { result } = renderHook(() => useReview());
  await waitFor(() => expect(result.current.review).not.toBeNull());

  // The next diff (for c1) resolves late with a distinctive file; the one after (c2)
  // resolves immediately with the default empty files and should win.
  let releaseStale: (() => void) | undefined;
  vi.mocked(api.diff).mockImplementationOnce(
    () =>
      new Promise((res) => {
        releaseStale = () =>
          res({ base: "b", head: "h", files: [{ newPath: "STALE", oldPath: "STALE", status: "modified", hunks: [] }] });
      }) as ReturnType<typeof api.diff>
  );

  act(() => result.current.setFrom("c1")); // slow (older reqSeq)
  act(() => result.current.setFrom("c2")); // fast, empty (newer reqSeq)
  await waitFor(() => expect(result.current.from).toBe("c2"));

  // Release the stale c1 response last — it must not clobber c2's (empty) result.
  await act(async () => {
    releaseStale?.();
    await Promise.resolve();
  });
  await new Promise((r) => setTimeout(r, 0));
  expect(result.current.files.some((f) => f.newPath === "STALE")).toBe(false);
});
