import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// A click fires on the common ancestor of press and release, so selecting text
// inside a modal and releasing over the backdrop reports the backdrop as the
// click's target — closing there threw away whatever was being edited.
import { Modal } from "./components/Modal";

const renderModal = (onClose: () => void) => {
  render(
    <Modal onClose={onClose} labelledBy="t">
      <h2 id="t">Prompts</h2>
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

test("a click inside the modal does not close", () => {
  const onClose = vi.fn();
  const { field } = renderModal(onClose);

  fireEvent.mouseDown(field);
  fireEvent.mouseUp(field);
  fireEvent.click(field);

  expect(onClose).not.toHaveBeenCalled();
});
