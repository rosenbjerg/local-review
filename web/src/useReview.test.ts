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
    summary: "",
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
import { readDiffViewPref } from "./storage";
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

  act(() => result.current.changeUncommitted(true));
  expect(result.current.worktreeSide).toBe(true); // uncommitted + unstaged(default) → working tree
  expect(result.current.indexedSide).toBe(false);

  act(() => result.current.changeUnstaged(false));
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
  // Reproduce the backend: /api/diff 400s for a sha that was rebased away. The
  // refetch must swallow that rejection and still run the `from`-reset — otherwise
  // the whole Promise.all rejects and `from` stays stuck at the dead sha.
  vi.mocked(api.diff).mockImplementation(async (_repo, _head, opts) => {
    if (opts.from === "c2") throw new Error("unknown commit: c2");
    return { base: "base", head: "head", files: [] };
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

// The other side of that reset: the picker asks for the newest 50 commits, so on a
// longer branch one new commit slides a still-valid pick out of the list. Treating
// that as "rebased away" silently widened the view to the whole branch — and `diff`
// pings are frequent, so it happened mid-review while an agent worked.
test("an SSE diff ping keeps a 'from' that only slid out of the commit window", async () => {
  const window50 = (offset: number) =>
    Array.from({ length: 50 }, (_, i) => {
      const n = offset + i;
      return { sha: `c${n}`, shortSha: `c${n}`, subject: `s${n}`, relDate: "" };
    });
  // c1 is the oldest commit the picker offers.
  vi.mocked(api.commits).mockResolvedValue({ commits: [...window50(2), { sha: "c1", shortSha: "c1", subject: "a", relDate: "" }] });
  const { result } = renderHook(() => useReview());
  await waitFor(() => expect(result.current.review).not.toBeNull()); // SSE now subscribed

  act(() => result.current.setFrom("c1"));
  expect(result.current.from).toBe("c1");

  // A commit lands: the window slides and c1 falls off the end, though it still exists.
  vi.mocked(api.commits).mockResolvedValue({ commits: window50(2) });
  const es = (globalThis as unknown as { EventSource: { instances: { onmessage: ((e: { data: string }) => void) | null }[] } }).EventSource.instances.at(-1);
  await act(async () => {
    es?.onmessage?.({ data: "diff" });
  });

  await waitFor(() => expect(result.current.fromOptions.some((o) => o.hint === "picked earlier")).toBe(true));
  expect(result.current.from).toBe("c1");
  // And it stays labelled, or the picker would render blank on a narrowed diff.
  expect(result.current.fromOptions.map((o) => o.value)).toContain("c1");
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

  act(() => result.current.changeUncommitted(true)); // working tree (staged + unstaged)
  await waitFor(() => expect(lastOpts()).toMatchObject({ from: "all", uncommitted: true, unstaged: true }));

  act(() => result.current.changeUnstaged(false)); // staged only → git index
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

  act(() => result.current.changeUncommitted(true));
  await waitFor(() => expect(result.current.uncommitted).toBe(false)); // guard turns it back off
  expect(result.current.worktreeSide).toBe(false);
  expect(result.current.indexedSide).toBe(false);
});

// The view axes are remembered per repo, so reopening a repo lands on the side you
// were last reviewing it from — and only that repo's (each keeps its own entry).
test("the view axes are restored per repo", async () => {
  const { result } = renderHook(() => useReview());
  await waitFor(() => expect(result.current.head).toBe("main"));

  act(() => result.current.changeUncommitted(true));
  act(() => result.current.changeUnstaged(false));

  act(() => result.current.changeRepo("B"));
  await waitFor(() => expect(result.current.head).toBe("main"));
  expect(result.current.uncommitted).toBe(false); // B has no pref of its own
  expect(result.current.unstaged).toBe(true);

  act(() => result.current.changeRepo("A"));
  await waitFor(() => expect(result.current.uncommitted).toBe(true));
  expect(result.current.unstaged).toBe(false);
  expect(result.current.indexedSide).toBe(true);
});

// Only a reviewer's toggle is a preference: the checked-out-branch guard also moves
// `uncommitted`, and persisting from that would erase the stored choice on a head
// switch — so the pref survives it and the axis comes back with the branch.
test("the checked-out-branch guard doesn't overwrite the stored axes", async () => {
  vi.mocked(api.branches).mockResolvedValue({
    main: "main",
    branches: [branch("main", { current: true, main: true }), branch("feature")],
  });
  const { result } = renderHook(() => useReview());
  await waitFor(() => expect(result.current.head).toBe("main"));

  act(() => result.current.changeUncommitted(true));
  act(() => result.current.changeHead("feature"));
  await waitFor(() => expect(result.current.uncommitted).toBe(false)); // forced off, not chosen

  expect(readDiffViewPref("A")).toEqual({ uncommitted: true, unstaged: true });
});

// The ping refetch must honour the same guard. An axis toggle keeps review.id, so the
// SSE effect's `cancelled` flag never fires — without the seq check the ping's diff
// (fetched under the old axes) lands after the toggle's, leaving hunks from one side
// while worktreeSide/indexedSide tell DiffView to read file content from another. That
// mismatch is what renders the wrong lines.
test("a ping's diff is dropped when a view axis moved while it was in flight", async () => {
  const { result } = renderHook(() => useReview());
  await waitFor(() => expect(result.current.review).not.toBeNull());
  await waitFor(() => expect(vi.mocked(api.diff).mock.calls.length).toBe(1)); // startReview's

  // The ping's diff is slow and carries the committed-range (uncommitted=false) files.
  let releaseStale: (() => void) | undefined;
  vi.mocked(api.diff).mockImplementationOnce(
    () =>
      new Promise((res) => {
        releaseStale = () =>
          res({
            base: "b",
            head: "h",
            files: [{ newPath: "STALE", oldPath: "STALE", status: "modified", hunks: [] }],
          });
      }) as ReturnType<typeof api.diff>
  );
  const es = (globalThis as unknown as { EventSource: { instances: { onmessage: ((e: { data: string }) => void) | null }[] } }).EventSource.instances.at(-1);
  act(() => {
    es?.onmessage?.({ data: "diff" });
  });
  await waitFor(() => expect(vi.mocked(api.diff).mock.calls.length).toBe(2)); // in flight

  // The user switches to the working-tree axis; that diff resolves first.
  vi.mocked(api.diff).mockResolvedValue({
    base: "b",
    head: "h",
    files: [{ newPath: "FRESH", oldPath: "FRESH", status: "modified", hunks: [] }],
  });
  act(() => result.current.changeUncommitted(true));
  await waitFor(() => expect(result.current.files.map((f) => f.newPath)).toEqual(["FRESH"]));
  expect(result.current.worktreeSide).toBe(true);

  await act(async () => {
    releaseStale?.();
    await Promise.resolve();
  });
  await new Promise((r) => setTimeout(r, 0));
  expect(result.current.files.map((f) => f.newPath)).toEqual(["FRESH"]);
});

// The review half of a ping refetch is fetched by id, so it stays valid even when the
// seq guard drops that ping's git state — gating it too would swallow the comment and
// reviewed-file updates the ping was sent for.
test("a ping still applies review state when its diff is dropped", async () => {
  vi.mocked(api.getReview).mockImplementation(async (id: number) => ({
    id,
    repoPath: "A",
    baseRef: "main",
    headRef: "main",
    headSha: "sha",
    status: "draft" as const,
    summary: "",
    createdAt: "",
    updatedAt: "",
    comments: [],
    reviewedFiles: ["reviewed.ts"],
  }));
  const { result } = renderHook(() => useReview());
  await waitFor(() => expect(result.current.review).not.toBeNull());

  let release: (() => void) | undefined;
  vi.mocked(api.diff).mockImplementationOnce(
    () => new Promise((res) => { release = () => res({ base: "b", head: "h", files: [] }); }) as ReturnType<typeof api.diff>
  );
  const es = (globalThis as unknown as { EventSource: { instances: { onmessage: ((e: { data: string }) => void) | null }[] } }).EventSource.instances.at(-1);
  act(() => {
    es?.onmessage?.({ data: "diff" });
  });
  await waitFor(() => expect(vi.mocked(api.diff).mock.calls.length).toBe(2));

  act(() => result.current.changeUncommitted(true)); // supersedes the ping's git state
  await act(async () => {
    release?.();
    await Promise.resolve();
  });
  await waitFor(() => expect([...result.current.reviewedFiles]).toEqual(["reviewed.ts"]));
});

// A review payload the create and ping reads both serve, so a ping can return
// byte-identical state (the common case) or a changed body.
const reviewWith = (body: string) => (id: number) => ({
  id,
  repoPath: "A",
  baseRef: "main",
  headRef: "main",
  headSha: "sha",
  status: "draft" as const,
  summary: "",
  createdAt: "",
  updatedAt: "",
  comments: [
    {
      id: 7,
      reviewId: id,
      filePath: "a.ts",
      startLine: 1,
      endLine: 1,
      type: "suggestion" as const,
      body,
      snippet: "s",
      author: "reviewer",
      createdAt: "",
      updatedAt: "",
    },
  ],
  reviewedFiles: ["reviewed.ts"],
});

const lastEventSource = () =>
  (globalThis as unknown as { EventSource: { instances: { onmessage: ((e: { data: string }) => void) | null }[] } })
    .EventSource.instances.at(-1);

// Pings are frequent (every comment mutation, plus the filesystem poller on any
// on-disk edit) and most change nothing the client holds. Since parsed JSON is a
// fresh object graph, applying it unconditionally would churn the identity of every
// value downstream and re-render every mounted file card for nothing — the cost of
// which grows with how many files the reviewer has scrolled past.
test("a ping that changes nothing keeps the review state's identity", async () => {
  const payload = reviewWith("b");
  vi.mocked(api.createReview).mockImplementation(async () => payload(1));
  vi.mocked(api.getReview).mockImplementation(async (id: number) => payload(id));
  const { result } = renderHook(() => useReview());
  await waitFor(() => expect(result.current.comments.length).toBe(1));
  const before = {
    review: result.current.review,
    comments: result.current.comments,
    reviewedFiles: result.current.reviewedFiles,
  };

  await act(async () => {
    lastEventSource()?.onmessage?.({ data: "meta" });
  });
  await waitFor(() => expect(vi.mocked(api.getReview).mock.calls.length).toBeGreaterThan(0));

  expect(result.current.review).toBe(before.review);
  expect(result.current.comments).toBe(before.comments);
  expect(result.current.reviewedFiles).toBe(before.reviewedFiles);
});

// ...and a ping that does change something must still land, or holding identity
// would just be swallowing updates.
test("a ping that changes a comment replaces it", async () => {
  vi.mocked(api.createReview).mockImplementation(async () => reviewWith("first")(1));
  vi.mocked(api.getReview).mockImplementation(async (id: number) => reviewWith("first")(id));
  const { result } = renderHook(() => useReview());
  await waitFor(() => expect(result.current.comments[0]?.body).toBe("first"));

  vi.mocked(api.getReview).mockImplementation(async (id: number) => reviewWith("edited")(id));
  await act(async () => {
    lastEventSource()?.onmessage?.({ data: "meta" });
  });

  await waitFor(() => expect(result.current.comments[0]?.body).toBe("edited"));
});

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

// A hidden tab still takes the review: the tab-title activity badge is the whole
// reason to know about a change you can't see. The diff is the expensive half and
// nothing renders it while hidden, so it's deferred — and it must actually arrive on
// return, since the focus fallback stands down while the stream is OPEN, leaving
// nothing else to fetch what the missed ping announced.
test("a ping while hidden takes the review and defers the diff until the tab returns", async () => {
  const { result } = renderHook(() => useReview());
  await waitFor(() => expect(result.current.review).not.toBeNull());
  const diffs = vi.mocked(api.diff).mock.calls.length;
  const reviews = vi.mocked(api.getReview).mock.calls.length;

  setVisibility("hidden");
  await act(async () => {
    lastEventSource()?.onmessage?.({ data: "diff" });
  });
  expect(vi.mocked(api.getReview).mock.calls.length).toBe(reviews + 1);
  expect(vi.mocked(api.diff).mock.calls.length).toBe(diffs);

  await act(async () => {
    setVisibility("visible");
  });
  await waitFor(() => expect(vi.mocked(api.diff).mock.calls.length).toBe(diffs + 1));
  setVisibility("visible");
});

// The deferral is only for what was missed; coming back with nothing outstanding
// must not refetch a diff the live stream would have pushed anyway.
test("returning to a tab that missed nothing does not refetch the diff", async () => {
  const { result } = renderHook(() => useReview());
  await waitFor(() => expect(result.current.review).not.toBeNull());
  const es = lastEventSource() as unknown as { readyState: number };
  es.readyState = 1; // OPEN
  const diffs = vi.mocked(api.diff).mock.calls.length;

  setVisibility("hidden");
  await act(async () => {
    lastEventSource()?.onmessage?.({ data: "meta" }); // comment churn, no content move
  });
  await act(async () => {
    setVisibility("visible");
  });

  await new Promise((r) => setTimeout(r, 0));
  expect(vi.mocked(api.diff).mock.calls.length).toBe(diffs);
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
