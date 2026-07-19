import { afterEach, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCommentRefs } from "./useCommentRefs";

function makeRef(id: string) {
  const a = document.createElement("a");
  a.className = "comment-ref";
  a.dataset.commentId = id;
  a.href = "#comment-" + id;
  a.textContent = "#" + id;
  document.body.appendChild(a);
  return a;
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("clicking a comment-ref navigates and prevents the native jump", () => {
  const jumpTo = vi.fn();
  renderHook(() => useCommentRefs(jumpTo));
  const a = makeRef("42");
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => {
    a.dispatchEvent(ev);
  });
  expect(jumpTo).toHaveBeenCalledWith(42);
  expect(ev.defaultPrevented).toBe(true);
});

test("clicking outside any comment-ref does nothing", () => {
  const jumpTo = vi.fn();
  renderHook(() => useCommentRefs(jumpTo));
  act(() => {
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  expect(jumpTo).not.toHaveBeenCalled();
});

test("hovering a comment-ref surfaces the popover after the delay", () => {
  vi.useFakeTimers();
  try {
    const { result } = renderHook(() => useCommentRefs(vi.fn()));
    const a = makeRef("42");
    act(() => {
      a.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(result.current).toBeNull(); // 250ms show delay not yet elapsed
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current?.id).toBe(42);
  } finally {
    vi.useRealTimers();
  }
});

test("focusing a comment-ref surfaces the popover immediately (keyboard)", () => {
  const { result } = renderHook(() => useCommentRefs(vi.fn()));
  const a = makeRef("43");
  act(() => {
    a.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
  expect(result.current?.id).toBe(43);
});
