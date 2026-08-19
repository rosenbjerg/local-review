import { expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// FileComments owns its composer's open state, which the three views that render
// it used to each hold for it. That makes the open/close rule its contract: a
// comment that landed closes the composer, and one that failed must leave it open
// *with the text still in it*, or a failed submit silently discards what was typed.
import { FileComments } from "./components/FileComments";
import type { Comment } from "./types";

const comment = (id: number, body: string): Comment =>
  ({ id, body, type: "suggestion", author: "reviewer", resolved: false, replies: [] }) as Comment;

const openComposer = () => fireEvent.click(screen.getByRole("button", { name: "+ Add file comment" }));

test("renders the file's threads through the given renderer", () => {
  render(
    <FileComments
      comments={[comment(1, "first"), comment(2, "second")]}
      renderThread={(c) => <div key={c.id}>thread:{c.body}</div>}
      onSubmit={async () => true}
    />
  );
  expect(screen.getByText("thread:first")).toBeTruthy();
  expect(screen.getByText("thread:second")).toBeTruthy();
});

test("a comment that lands closes the composer", async () => {
  const onSubmit = vi.fn(async () => true);
  render(<FileComments comments={[]} renderThread={() => null} onSubmit={onSubmit} />);

  openComposer();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "about this file" } });
  fireEvent.click(screen.getByRole("button", { name: "Add comment" }));

  expect(onSubmit).toHaveBeenCalledWith("about this file", "suggestion");
  await waitFor(() => expect(screen.getByRole("button", { name: "+ Add file comment" })).toBeTruthy());
  expect(screen.queryByRole("textbox")).toBeNull();
});

test("a comment that failed keeps the composer open with the text", async () => {
  const onSubmit = vi.fn(async () => false);
  render(<FileComments comments={[]} renderThread={() => null} onSubmit={onSubmit} />);

  openComposer();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "worth retrying" } });
  fireEvent.click(screen.getByRole("button", { name: "Add comment" }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("worth retrying");
});

test("cancel closes the composer without submitting", () => {
  const onSubmit = vi.fn(async () => true);
  render(<FileComments comments={[]} renderThread={() => null} onSubmit={onSubmit} />);

  openComposer();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "+ Add file comment" })).toBeTruthy();
});
