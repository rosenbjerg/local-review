import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { SearchInput } from "./components/SearchInput";

// Escape is the dismiss gesture: it clears a non-empty field, and on an empty one
// either blurs (the panes, handing the keyboard back to the global shortcuts) or
// bubbles (a modal, whose own Escape closes it). Whatever it does to the field, a
// window listener — useKeyboardShortcuts, Modal — must not also see it.

function field(value: string, over: Partial<Parameters<typeof SearchInput>[0]> = {}) {
  const onChange = vi.fn();
  render(<SearchInput value={value} onChange={onChange} ariaLabel="Search" {...over} />);
  return { onChange, input: screen.getByLabelText("Search") as HTMLInputElement };
}

function withWindowListener(run: (onKeyDown: ReturnType<typeof vi.fn>) => void) {
  const onKeyDown = vi.fn();
  window.addEventListener("keydown", onKeyDown);
  try {
    run(onKeyDown);
  } finally {
    window.removeEventListener("keydown", onKeyDown);
  }
}

test("Escape on a non-empty field clears it without reaching the window", () => {
  withWindowListener((windowKey) => {
    const { onChange, input } = field("api");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onChange).toHaveBeenCalledWith("");
    expect(windowKey).not.toHaveBeenCalled();
  });
});

test("Escape on an empty field blurs it by default, still swallowed", () => {
  withWindowListener((windowKey) => {
    const { onChange, input } = field("");
    input.focus();
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(input);
    expect(windowKey).not.toHaveBeenCalled();
  });
});

test("Escape on an empty field bubbles when asked, so a modal can close on it", () => {
  withWindowListener((windowKey) => {
    const { onChange, input } = field("", { emptyEscape: "bubble" });
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    expect(windowKey).toHaveBeenCalledTimes(1);
  });
});

test("the clear button clears and hands focus back to the field", () => {
  const { onChange, input } = field("api");
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(onChange).toHaveBeenCalledWith("");
  expect(document.activeElement).toBe(input);
});

test("an empty field shows no clear button", () => {
  field("");
  expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
});

test("other keys reach the caller's handler; Escape never does", () => {
  const onKeyDown = vi.fn();
  const { input } = field("api", { onKeyDown });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(onKeyDown).toHaveBeenCalledTimes(1);
  expect(onKeyDown.mock.calls[0][0].key).toBe("ArrowDown");
});

test("autoFocus marks the field as the focus trap's initial target", () => {
  const { input } = field("", { autoFocus: true });
  expect(input.hasAttribute("data-autofocus")).toBe(true);
});
