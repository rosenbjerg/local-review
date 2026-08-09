import { afterEach, expect, test } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Comment, Reply } from "./types";
import { useUnseenActivity } from "./useUnseenActivity";

const comment = (id: number, author: string, replies: Reply[] = []): Comment =>
  ({ id, author, replies }) as Comment;

const reply = (id: number, author: string): Reply => ({ id, author }) as Reply;

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

afterEach(() => setVisibility("visible"));

test("agent comments arriving while hidden are counted, and looking clears them", () => {
  const { result, rerender } = renderHook(({ cs }) => useUnseenActivity(cs, 1), {
    initialProps: { cs: [comment(1, "reviewer")] },
  });
  expect(result.current).toBe(0);

  setVisibility("hidden");
  rerender({ cs: [comment(1, "reviewer"), comment(2, "review-agent")] });
  expect(result.current).toBe(1);

  // A second arrival while still away accumulates rather than replacing.
  rerender({ cs: [comment(1, "reviewer"), comment(2, "review-agent"), comment(3, "agent")] });
  expect(result.current).toBe(2);

  setVisibility("visible");
  expect(result.current).toBe(0);
});

test("replies count as activity too — an agent answering a thread is the point", () => {
  const { result, rerender } = renderHook(({ cs }) => useUnseenActivity(cs, 1), {
    initialProps: { cs: [comment(1, "reviewer")] },
  });
  setVisibility("hidden");
  rerender({ cs: [comment(1, "reviewer", [reply(7, "agent")])] });
  expect(result.current).toBe(1);
});

test("the reviewer's own comments are never activity", () => {
  const { result, rerender } = renderHook(({ cs }) => useUnseenActivity(cs, 1), {
    initialProps: { cs: [] as Comment[] },
  });
  setVisibility("hidden");
  rerender({ cs: [comment(1, "reviewer", [reply(7, "reviewer")])] });
  expect(result.current).toBe(0);
});

// Opening a review in a background tab must not badge its whole history.
test("what is already there on the first read is history, not activity", () => {
  setVisibility("hidden");
  const { result } = renderHook(() => useUnseenActivity([comment(1, "review-agent")], 1));
  expect(result.current).toBe(0);
});

test("switching review primes against the new review rather than counting it", () => {
  const { result, rerender } = renderHook(({ cs, id }) => useUnseenActivity(cs, id), {
    initialProps: { cs: [comment(1, "agent")], id: 1 },
  });
  setVisibility("hidden");
  rerender({ cs: [comment(9, "agent"), comment(10, "review-agent")], id: 2 });
  expect(result.current).toBe(0);

  rerender({ cs: [comment(9, "agent"), comment(10, "review-agent"), comment(11, "agent")], id: 2 });
  expect(result.current).toBe(1);
});
