import { expect, test } from "vitest";
import { commentSignal, pathSignal } from "./cardSignals";
import type { Comment } from "./types";

const comment = (id: number) => ({ id }) as Comment;

test("a path signal reaches only the card it names, keeping its identity", () => {
  const signal = { path: "a.ts", n: 1 };
  expect(pathSignal(signal, "a.ts")).toBe(signal);
  expect(pathSignal(signal, "b.ts")).toBeNull();
  expect(pathSignal(null, "a.ts")).toBeNull();
});

test("a comment signal reaches only the card holding that comment", () => {
  const signal = { id: 7, n: 2 };
  expect(commentSignal(signal, [comment(3), comment(7)])).toBe(signal);
  expect(commentSignal(signal, [comment(3)])).toBeNull();
  expect(commentSignal(7, [comment(7)])).toBe(7);
  expect(commentSignal(7, [])).toBeNull();
  expect(commentSignal(null, [comment(7)])).toBeNull();
});
