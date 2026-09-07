import { expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { KeyboardEvent } from "react";

import { useListNavigation } from "./useListNavigation";

// The keyboard half of a filtered list, shared by the combobox and the add-file
// picker: arrows move the active row and stop at the ends, Enter picks it, and
// the row stays in range when the filter shrinks the list under it.

function key(k: string) {
  return { key: k, preventDefault: vi.fn() } as unknown as KeyboardEvent & {
    preventDefault: ReturnType<typeof vi.fn>;
  };
}

function nav(length: number, onPick = vi.fn()) {
  const listRef = { current: null };
  const hook = renderHook(
    ({ length }: { length: number }) => useListNavigation({ length, onPick, listRef }),
    { initialProps: { length } }
  );
  return { ...hook, onPick };
}

test("arrows move the active row and stop at both ends", () => {
  const { result } = nav(3);
  expect(result.current.active).toBe(0);

  act(() => {
    result.current.onKeyDown(key("ArrowUp"));
  });
  expect(result.current.active).toBe(0);

  act(() => {
    result.current.onKeyDown(key("ArrowDown"));
  });
  act(() => {
    result.current.onKeyDown(key("ArrowDown"));
  });
  act(() => {
    result.current.onKeyDown(key("ArrowDown"));
  });
  expect(result.current.active).toBe(2);
});

test("Enter picks the active row, and picks nothing from an empty list", () => {
  const { result, onPick } = nav(3);
  act(() => {
    result.current.onKeyDown(key("ArrowDown"));
  });
  const enter = key("Enter");
  act(() => {
    result.current.onKeyDown(enter);
  });
  expect(onPick).toHaveBeenCalledWith(1);
  expect(enter.preventDefault).toHaveBeenCalled();

  const empty = nav(0);
  const enter2 = key("Enter");
  act(() => {
    empty.result.current.onKeyDown(enter2);
  });
  expect(empty.onPick).not.toHaveBeenCalled();
  expect(enter2.preventDefault).not.toHaveBeenCalled();
});

test("the active row follows the list down as the filter shrinks it", () => {
  const { result, rerender } = nav(5);
  act(() => {
    result.current.setActive(4);
  });
  rerender({ length: 2 });
  expect(result.current.active).toBe(1);
  rerender({ length: 0 });
  expect(result.current.active).toBe(0);
});

test("an empty list never steps below its first row", () => {
  const { result } = nav(0);
  act(() => {
    result.current.onKeyDown(key("ArrowDown"));
  });
  expect(result.current.active).toBe(0);
});

test("a key that isn't the list's is left to the caller", () => {
  const { result } = nav(3);
  const esc = key("Escape");
  let taken = true;
  act(() => {
    taken = result.current.onKeyDown(esc);
  });
  expect(taken).toBe(false);
  expect(esc.preventDefault).not.toHaveBeenCalled();
  expect(result.current.onKeyDown(key("ArrowDown"))).toBe(true);
});
