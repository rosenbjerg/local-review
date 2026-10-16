import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearDrafts, getDrafts } from "./drafts";

// The comments pane's collapse button leads the summary's first row, whichever state the
// summary is in, so it sits at the top of the pane like the files pane's.
import { ReviewSummary } from "./components/ReviewSummary";

afterEach(() => act(() => clearDrafts()));

const collapseIn = (row: Element | null) =>
  row?.querySelector('[aria-label="Hide the comments panel"]') ?? null;

test("the collapse button shares a row with the add link, the heading, and the editor's heading", () => {
  const onCollapse = vi.fn();
  const { container, rerender } = render(
    <ReviewSummary summary="" onSave={async () => true} onCollapse={onCollapse} />
  );
  const head = () => container.querySelector(".review-summary-head");

  expect(head()!.textContent).toContain("+ Add a review summary");
  fireEvent.click(collapseIn(head())!);
  expect(onCollapse).toHaveBeenCalledTimes(1);

  rerender(<ReviewSummary summary="ship it" onSave={async () => true} onCollapse={onCollapse} />);
  expect(head()!.textContent).toContain("Summary");
  expect(collapseIn(head())).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "edit" }));
  expect(screen.getByRole("textbox")).toBeTruthy();
  expect(collapseIn(head())).toBeTruthy();
  expect(screen.getAllByLabelText("Hide the comments panel")).toHaveLength(1);
});

test("an unsaved summary edit outlives the pane closing, and a failed save keeps it open", async () => {
  const onSave = vi.fn(async () => false);
  const first = render(<ReviewSummary summary="" onSave={onSave} onCollapse={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "+ Add a review summary" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "half-written" } });
  expect(getDrafts().size).toBe(1);
  first.unmount();

  render(<ReviewSummary summary="" onSave={onSave} onCollapse={() => {}} />);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("half-written");

  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith("half-written"));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("half-written");
  expect(getDrafts().size).toBe(1);

  onSave.mockResolvedValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  expect(getDrafts().size).toBe(0);
});
