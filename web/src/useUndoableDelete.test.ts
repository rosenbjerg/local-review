import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("./api", () => {
  class ApiError extends Error {
    constructor(
      message: string,
      readonly status: number
    ) {
      super(message);
    }
  }
  return { ApiError, api: { deleteComment: vi.fn(async () => undefined) } };
});

import { ApiError, api } from "./api";
import { UNDO_MS, useUndoableDelete } from "./useUndoableDelete";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.mocked(api.deleteComment).mockReset();
  vi.mocked(api.deleteComment).mockResolvedValue(undefined);
});

function setup(reviewId = 1) {
  const setComments = vi.fn();
  const setError = vi.fn();
  const hook = renderHook(({ id }) => useUndoableDelete({ setComments, setError, reviewId: id }), {
    initialProps: { id: reviewId },
  });
  return { ...hook, setComments, setError };
}

test("a delete hides the thread at once but reaches the server only after the undo window", async () => {
  const { result } = setup();
  act(() => void result.current.remove(3));

  expect(result.current.hidden.has(3)).toBe(true);
  expect(api.deleteComment).not.toHaveBeenCalled();

  await act(async () => {
    vi.advanceTimersByTime(UNDO_MS);
  });
  expect(api.deleteComment).toHaveBeenCalledWith(3);
  expect(result.current.pending).toBeNull();
});

test("undo brings the thread back and never deletes it", async () => {
  const { result } = setup();
  act(() => void result.current.remove(3));
  act(() => result.current.undo());

  expect(result.current.hidden.size).toBe(0);
  await act(async () => {
    vi.advanceTimersByTime(UNDO_MS * 2);
  });
  expect(api.deleteComment).not.toHaveBeenCalled();
});

test("a second delete commits the first rather than dropping it", async () => {
  const { result } = setup();
  act(() => void result.current.remove(3));
  await act(async () => void result.current.remove(4));

  expect(api.deleteComment).toHaveBeenCalledWith(3);
  expect(result.current.pending).toBe(4);
});

test("switching review commits the pending delete", async () => {
  const { result, rerender } = setup(1);
  act(() => void result.current.remove(3));
  await act(async () => rerender({ id: 2 }));

  expect(api.deleteComment).toHaveBeenCalledWith(3);
});

test("a thread already gone on the server counts as deleted", async () => {
  vi.mocked(api.deleteComment).mockRejectedValue(new ApiError("not found", 404));
  const { result, setComments, setError } = setup();
  act(() => void result.current.remove(3));
  await act(async () => {
    vi.advanceTimersByTime(UNDO_MS);
  });

  expect(setError).not.toHaveBeenCalledWith("not found");
  expect(setComments).toHaveBeenCalled();
});

test("a failed delete shows the error and un-hides the thread", async () => {
  vi.mocked(api.deleteComment).mockRejectedValue(new ApiError("boom", 500));
  const { result, setComments, setError } = setup();
  act(() => void result.current.remove(3));
  await act(async () => {
    vi.advanceTimersByTime(UNDO_MS);
  });

  expect(setError).toHaveBeenCalledWith("boom");
  expect(setComments).not.toHaveBeenCalled();
  expect(result.current.hidden.size).toBe(0);
});

test("leaving the page sends the pending delete without waiting for the window", () => {
  const { result } = setup();
  act(() => void result.current.remove(3));
  window.dispatchEvent(new Event("pagehide"));

  expect(api.deleteComment).toHaveBeenCalledWith(3, { keepalive: true });
});
