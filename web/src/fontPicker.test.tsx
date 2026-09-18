import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { FontPicker } from "./components/FontPicker";

// A browser without the Local Font Access API — jsdom as it comes — with a canvas that knows Menlo.
const ctx = {
  font: "",
  measureText: () => ({ width: ctx.font.includes('"Menlo"') ? 200 : 100 }),
};
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
  ctx as unknown as CanvasRenderingContext2D
);

// Firefox can't say whether the face is absent or hidden, and Safari hides what was installed by
// hand, so the note names the browser rather than the machine — and never an access it cannot ask for.
test("a face the browser can't resolve is reported without any mention of access", () => {
  render(<FontPicker />);
  const code = screen.getByLabelText("Code font") as HTMLInputElement;
  fireEvent.change(code, { target: { value: "SF Pro" } });
  expect(screen.getByText(/SF Pro isn't available to this browser/)).toBeTruthy();
  expect(screen.queryByText(/allow access/)).toBeNull();
  expect(screen.queryByText(/installed on this machine/)).toBeNull();

  fireEvent.change(code, { target: { value: "Menlp" } });
  fireEvent.click(screen.getByText("use Menlo?"));
  expect(code.value).toBe("Menlo");
  expect(screen.queryByText(/isn't available/)).toBeNull();

  // Shipped with the app, so it is there whether or not the theme has loaded it yet.
  fireEvent.change(code, { target: { value: "JetBrains Mono" } });
  expect(screen.queryByText(/isn't available/)).toBeNull();
  fireEvent.click(screen.getByText("Reset"));
});
