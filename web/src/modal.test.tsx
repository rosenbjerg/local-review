import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// A click fires on the common ancestor of press and release, so selecting text
// inside a modal and releasing over the backdrop reports the backdrop as the
// click's target — closing there threw away whatever was being edited.
import { Modal } from "./components/Modal";

const renderModal = (onClose: () => void) => {
  render(
    <Modal onClose={onClose} title="Prompts">
      <textarea defaultValue="prompt text" />
    </Modal>
  );
  return {
    backdrop: document.querySelector(".modal-backdrop")!,
    field: screen.getByRole("textbox"),
  };
};

test("a press and release on the backdrop closes", () => {
  const onClose = vi.fn();
  const { backdrop } = renderModal(onClose);

  fireEvent.mouseDown(backdrop);
  fireEvent.mouseUp(backdrop);
  fireEvent.click(backdrop);

  expect(onClose).toHaveBeenCalled();
});

test("a drag that starts inside and ends on the backdrop does not close", () => {
  const onClose = vi.fn();
  const { backdrop, field } = renderModal(onClose);

  fireEvent.mouseDown(field);
  fireEvent.mouseUp(backdrop);
  fireEvent.click(backdrop);

  expect(onClose).not.toHaveBeenCalled();
});

test("a drag that starts on the backdrop and ends inside does not close", () => {
  const onClose = vi.fn();
  const { backdrop, field } = renderModal(onClose);

  fireEvent.mouseDown(backdrop);
  fireEvent.mouseUp(field);
  fireEvent.click(backdrop);

  expect(onClose).not.toHaveBeenCalled();
});

// The shell owns the head: the title is what names the dialog, and the Close
// button is the one every modal used to write by hand — except the confirm, whose
// body carries its own way out.
test("the title names the dialog and the head's Close button closes it", () => {
  const onClose = vi.fn();
  renderModal(onClose);
  expect(screen.getByRole("dialog", { name: "Prompts" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalled();
});

test("close='none' leaves the head with no Close button", () => {
  render(
    <Modal onClose={() => {}} title="Reset?" close="none">
      <button>Cancel</button>
    </Modal>
  );
  expect(screen.getByRole("dialog", { name: "Reset?" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
});

test("close='autofocus' opens with focus on Close", () => {
  render(
    <Modal onClose={() => {}} title="Settings" close="autofocus">
      <select aria-label="Theme" />
    </Modal>
  );
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
});

test("a click inside the modal does not close", () => {
  const onClose = vi.fn();
  const { field } = renderModal(onClose);

  fireEvent.mouseDown(field);
  fireEvent.mouseUp(field);
  fireEvent.click(field);

  expect(onClose).not.toHaveBeenCalled();
});
