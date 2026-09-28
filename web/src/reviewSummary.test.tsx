import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// The comments pane's collapse button leads the summary's first row, whichever state the
// summary is in, so it sits at the top of the pane like the files pane's.
import { ReviewSummary } from "./components/ReviewSummary";

const collapseIn = (row: Element | null) =>
  row?.querySelector('[aria-label="Hide the comments panel"]') ?? null;

test("the collapse button shares a row with the add link, the heading, and the editor's heading", () => {
  const onCollapse = vi.fn();
  const { container, rerender } = render(
    <ReviewSummary summary="" onSave={() => {}} onCollapse={onCollapse} />
  );
  const head = () => container.querySelector(".review-summary-head");

  expect(head()!.textContent).toContain("+ Add a review summary");
  fireEvent.click(collapseIn(head())!);
  expect(onCollapse).toHaveBeenCalledTimes(1);

  rerender(<ReviewSummary summary="ship it" onSave={() => {}} onCollapse={onCollapse} />);
  expect(head()!.textContent).toContain("Summary");
  expect(collapseIn(head())).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "edit" }));
  expect(screen.getByRole("textbox")).toBeTruthy();
  expect(collapseIn(head())).toBeTruthy();
  expect(screen.getAllByLabelText("Hide the comments panel")).toHaveLength(1);
});
