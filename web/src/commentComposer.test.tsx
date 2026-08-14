import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// The type picker is a radiogroup of pills rather than a select, so the keyboard
// contract is ours to hold: one tab stop for the group, arrows move (and wrap)
// the selection, and whatever is selected is what onSubmit carries.
import { CommentComposer } from "./components/CommentComposer";

function pill(type: string) {
  return screen.getByRole("radio", { name: type });
}

test("a click picks the type the submit carries", async () => {
  const onSubmit = vi.fn();
  render(<CommentComposer onSubmit={onSubmit} onCancel={() => {}} />);

  expect(pill("suggestion").getAttribute("aria-checked")).toBe("true");
  fireEvent.click(pill("bug"));
  expect(pill("bug").getAttribute("aria-checked")).toBe("true");
  expect(pill("suggestion").getAttribute("aria-checked")).toBe("false");

  fireEvent.change(screen.getByRole("textbox"), { target: { value: " body " } });
  fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
  expect(onSubmit).toHaveBeenCalledWith("body", "bug");
});

test("only the selected pill is tabbable, so the group is one tab stop", () => {
  render(<CommentComposer initialType="question" onSubmit={() => {}} onCancel={() => {}} />);

  const tabbable = screen
    .getAllByRole("radio")
    .filter((p) => p.getAttribute("tabindex") === "0")
    .map((p) => p.textContent);
  expect(tabbable).toEqual(["question"]);
});

test("arrows move the selection and wrap at both ends", () => {
  render(<CommentComposer initialType="bug" onSubmit={() => {}} onCancel={() => {}} />);
  const group = screen.getByRole("radiogroup");

  // bug is first: left wraps to the last type.
  fireEvent.keyDown(group, { key: "ArrowLeft" });
  expect(pill("nit").getAttribute("aria-checked")).toBe("true");
  // Focus follows the selection, as a native radiogroup does.
  expect(document.activeElement).toBe(pill("nit"));

  // nit is last: right wraps back to the first.
  fireEvent.keyDown(group, { key: "ArrowRight" });
  expect(pill("bug").getAttribute("aria-checked")).toBe("true");

  fireEvent.keyDown(group, { key: "ArrowDown" });
  expect(pill("suggestion").getAttribute("aria-checked")).toBe("true");
});

// Picking a type by click is a finished choice, so the caret goes back to the
// body — arrow-keying isn't, and must leave focus in the group for the next arrow.
test("a click hands focus to the textarea; an arrow keeps it on the pills", () => {
  render(<CommentComposer onSubmit={() => {}} onCancel={() => {}} />);

  fireEvent.click(pill("bug"));
  expect(document.activeElement).toBe(screen.getByRole("textbox"));

  fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
  expect(document.activeElement).toBe(pill("suggestion"));
});

test("a reply composer has no type picker at all", () => {
  render(<CommentComposer hideType onSubmit={() => {}} onCancel={() => {}} />);
  expect(screen.queryByRole("radiogroup")).toBeNull();
});

// Submit/cancel are bound on the composer root, not the textarea, because the
// global shortcuts bail on the whole `.composer` subtree — bound any narrower and
// both keys would be dead on the pills and the Cancel/Submit buttons.
test("Escape and ⌘+Enter work from a focused pill, not just the textarea", () => {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(<CommentComposer initialBody="body" onSubmit={onSubmit} onCancel={onCancel} />);

  fireEvent.keyDown(pill("bug"), { key: "Enter", metaKey: true });
  expect(onSubmit).toHaveBeenCalledWith("body", "suggestion");

  fireEvent.keyDown(pill("bug"), { key: "Escape" });
  expect(onCancel).toHaveBeenCalled();
});
