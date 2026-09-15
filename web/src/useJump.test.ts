import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
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

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// jsdom lays nothing out; the diff column's geometry is faked so the landing offset says which
// card the jump aimed at. Both sit far enough down that the scroll lands on its first frame.
function column() {
  const root = document.createElement("div");
  document.body.appendChild(root);
  Object.defineProperty(root, "clientHeight", { value: 500 });
  Object.defineProperty(root, "scrollHeight", { value: 20000 });
  root.getBoundingClientRect = () => ({ top: 0, height: 500 }) as DOMRect;
  const ref = createRef<HTMLElement>();
  (ref as { current: HTMLElement | null }).current = root;
  return { root, ref };
}

function fileAnchor(root: HTMLElement, path: string, docTop: number) {
  const el = document.createElement("div");
  el.id = `file-${path}`;
  root.appendChild(el);
  el.getBoundingClientRect = () => ({ top: docTop - root.scrollTop, height: 200 }) as DOMRect;
  return el;
}

// Every card is keyed by effectivePath, so a comment the server relocated across a rename
// lives under currentFilePath. Naming the stored path would scroll to nothing and leave the
// expand signal matching no DiffView, so the thread would never mount.
test("jumping to a rename-moved comment targets the card at its current path", () => {
  const c = comment({ anchorStatus: "moved", currentFilePath: "new.go", currentStartLine: 5 });
  const { root, ref } = column();
  const { result } = renderHook(() =>
    useJump({ comments: [c], setSelectedFile: () => {}, rootRef: ref })
  );
  fileAnchor(root, "old.go", 3000);
  fileAnchor(root, "new.go", 9000);

  act(() => result.current.jumpTo(1));
  act(() => vi.advanceTimersByTime(500));

  expect(root.scrollTop).toBe(9000 - 8);
  expect(result.current.expandTarget?.path).toBe("new.go");

  act(() => result.current.resetJump());
});

// An unmoved comment still goes to its own path — effectivePath falls back to it.
test("jumping to a comment that hasn't moved targets its stored path", () => {
  const { root, ref } = column();
  const { result } = renderHook(() =>
    useJump({ comments: [comment({})], setSelectedFile: () => {}, rootRef: ref })
  );
  fileAnchor(root, "old.go", 9000);

  act(() => result.current.jumpTo(1));
  act(() => vi.advanceTimersByTime(500));

  expect(root.scrollTop).toBe(9000 - 8);
  expect(result.current.expandTarget?.path).toBe("old.go");

  act(() => result.current.resetJump());
});

// The card is the stand-in until the thread inside it mounts, which is the whole reason a jump
// into an unmounted file used to land short of the comment.
test("a thread that mounts after the jump takes the aim over from its card", () => {
  const { root, ref } = column();
  const { result } = renderHook(() =>
    useJump({ comments: [comment({})], setSelectedFile: () => {}, rootRef: ref })
  );
  fileAnchor(root, "old.go", 9000);

  act(() => result.current.jumpTo(1));
  act(() => vi.advanceTimersByTime(500));
  expect(root.scrollTop).toBe(8992);


  const thread = document.createElement("div");
  thread.id = "comment-1";
  root.appendChild(thread);
  thread.getBoundingClientRect = () => ({ top: 12000 - root.scrollTop, height: 100 }) as DOMRect;
  act(() => vi.advanceTimersByTime(600));

  // Centred, not top-aligned: a thread reads with the code around it.
  expect(root.scrollTop).toBe(12000 - 200);
  expect(thread.classList.contains("thread-flash")).toBe(true);

  act(() => result.current.resetJump());
});

test("jumping to a file scrolls to its card and selects it", () => {
  const { root, ref } = column();
  const selected: string[] = [];
  const { result } = renderHook(() =>
    useJump({ comments: [], setSelectedFile: (p) => selected.push(p), rootRef: ref })
  );
  fileAnchor(root, "a.go", 9000);

  act(() => result.current.jumpToFile("a.go"));
  act(() => vi.advanceTimersByTime(500));

  expect(selected).toEqual(["a.go"]);
  expect(root.scrollTop).toBe(8992);

  act(() => result.current.resetJump());
});

// Rapid n/p used to stack scroll loops that then fought each other.
test("a second jump supersedes the first", () => {
  const { root, ref } = column();
  const { result } = renderHook(() =>
    useJump({ comments: [], setSelectedFile: () => {}, rootRef: ref })
  );
  fileAnchor(root, "a.go", 9000);
  fileAnchor(root, "b.go", 15000);

  act(() => result.current.jumpToFile("a.go"));
  act(() => vi.advanceTimersByTime(16));
  act(() => result.current.jumpToFile("b.go"));
  act(() => vi.advanceTimersByTime(500));

  expect(root.scrollTop).toBe(15000 - 8);
  act(() => vi.advanceTimersByTime(2000));
  expect(root.scrollTop).toBe(15000 - 8);

  act(() => result.current.resetJump());
});

// The spy can't cover a jump: its scroll events all land inside the suppression the jump itself
// starts, so nothing would move selectedFile off the file being left — and mark-reviewed would then
// mark that one.
test("jumping to a comment selects the file it lives in", () => {
  const { root, ref } = column();
  const selected: string[] = [];
  const c = comment({ anchorStatus: "moved", currentFilePath: "new.go", currentStartLine: 5 });
  const { result } = renderHook(() =>
    useJump({ comments: [c], setSelectedFile: (p) => selected.push(p), rootRef: ref })
  );
  fileAnchor(root, "new.go", 9000);

  act(() => result.current.jumpTo(1));

  expect(selected).toEqual(["new.go"]);

  act(() => result.current.resetJump());
});

// A `[#42]` ref clicked while the comment list is mid-refetch: the thread is on screen, so the jump
// still has somewhere to go.
test("a comment absent from the list is still reachable if its thread is mounted", () => {
  const { root, ref } = column();
  const { result } = renderHook(() =>
    useJump({ comments: [], setSelectedFile: () => {}, rootRef: ref })
  );
  const thread = document.createElement("div");
  thread.id = "comment-42";
  root.appendChild(thread);
  thread.getBoundingClientRect = () => ({ top: 9000 - root.scrollTop, height: 100 }) as DOMRect;

  act(() => result.current.jumpTo(42));
  act(() => vi.advanceTimersByTime(500));

  expect(root.scrollTop).toBe(9000 - 200);
  expect(thread.classList.contains("thread-flash")).toBe(true);

  act(() => result.current.resetJump());
});
