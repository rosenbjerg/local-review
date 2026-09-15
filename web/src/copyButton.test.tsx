import { expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CopyButton } from "./components/CopyButton";

function stubClipboard(impl: () => Promise<void> = async () => {}) {
  const writeText = vi.fn(impl);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

test("icon mode keeps its accessible name while the title reports the outcome", async () => {
  stubClipboard();
  render(<CopyButton icon idleLabel="Copy path" title="Copy the file path" text="a/b.go" />);

  const btn = screen.getByRole("button", { name: "Copy path" });
  expect(btn.getAttribute("title")).toBe("Copy the file path");

  fireEvent.click(btn);

  await waitFor(() => expect(btn.getAttribute("title")).toBe("Copied ✓"));
  expect(screen.getByRole("button", { name: "Copy path" })).toBe(btn);
});

test("a failed copy is visible without a label to carry it", async () => {
  stubClipboard(async () => {
    throw new Error("denied");
  });
  render(<CopyButton icon idleLabel="Copy path" text="a/b.go" />);

  const btn = screen.getByRole("button", { name: "Copy path" });
  fireEvent.click(btn);

  await waitFor(() => expect(btn.className).toContain("copy-fail"));
  expect(btn.getAttribute("title")).toBe("Copy failed");
});

test("text mode still swaps its label", async () => {
  stubClipboard();
  render(<CopyButton idleLabel="copy" text="a/b.go:3" />);

  fireEvent.click(screen.getByRole("button", { name: "copy" }));

  await waitFor(() => expect(screen.getByRole("button", { name: "Copied ✓" })).toBeTruthy());
});

test("a lazy text is resolved at click time, not at render", () => {
  const writeText = stubClipboard();
  let lines = "3";
  render(<CopyButton idleLabel="copy" text={() => `a/b.go:${lines}`} />);

  lines = "5-7";
  fireEvent.click(screen.getByRole("button", { name: "copy" }));

  expect(writeText).toHaveBeenCalledWith("a/b.go:5-7");
});
