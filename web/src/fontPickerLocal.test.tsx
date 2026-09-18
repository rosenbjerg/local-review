import { expect, test, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { FontPicker } from "./components/FontPicker";

// A Chromium with the Local Font Access API, nothing granted yet, on a machine with SF Pro and a
// Canela the browser will refuse. A face measures differently only once its bytes have arrived —
// which, as in Brave, is the only way a font the browser blocks by name ever renders.
const arrived = new Set<string>();
const ctx = {
  font: "",
  measureText: () => ({
    width: [...arrived].some((f) => ctx.font.toLowerCase().includes(`"${f.toLowerCase()}"`)) ? 200 : 100,
  }),
};
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
  ctx as unknown as CanvasRenderingContext2D
);
class FakeFontFace {
  constructor(
    public family: string,
    private bytes: ArrayBuffer
  ) {}
  load() {
    return this.bytes.byteLength === 0 ? Promise.reject(new Error("refused")) : Promise.resolve(this);
  }
}
vi.stubGlobal("FontFace", FakeFontFace);
Object.defineProperty(document, "fonts", {
  configurable: true,
  value: { add: (f: FakeFontFace) => arrived.add(f.family) },
});
const file = (family: string, size = 4) => ({
  family,
  blob: () => Promise.resolve(new Blob([new Uint8Array(size)])),
});
const permission = { state: "prompt" as PermissionState, onchange: null as (() => void) | null };
Object.defineProperty(navigator, "permissions", {
  configurable: true,
  value: { query: () => Promise.resolve(permission) },
});
const queryLocalFonts = vi.fn(() => Promise.resolve([file("SF Pro"), file("SF Pro"), file("Canela", 0)]));
Object.assign(window, { queryLocalFonts });

const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

test("the allow action appears where a blocked face is typed, and the face arrives once granted", async () => {
  render(<FontPicker />);
  const code = screen.getByLabelText("Code font") as HTMLInputElement;
  fireEvent.change(code, { target: { value: "sf pro" } });
  await settle();
  expect(screen.getByText(/sf pro isn't available to this browser/)).toBeTruthy();

  fireEvent.click(screen.getByText("allow access to installed fonts?"));
  await settle();
  expect(queryLocalFonts).toHaveBeenCalledTimes(1);
  expect(arrived.has("SF Pro")).toBe(true);
  expect(screen.queryByText(/isn't available/)).toBeNull();
  expect(screen.queryByText(/Loading/)).toBeNull();

  // Granted, the machine's own spelling can be offered for one that only nearly matches.
  fireEvent.change(code, { target: { value: "sfpro" } });
  fireEvent.click(screen.getByText("use it?"));
  expect(code.value).toBe("SF Pro");
  expect(screen.queryByText(/Installed here/)).toBeNull();

  // And absent can be told from blocked.
  fireEvent.change(code, { target: { value: "Graphik" } });
  await settle();
  expect(screen.getByText(/Graphik isn't among the fonts installed on this machine/)).toBeTruthy();

  // Access withdrawn in site settings reaches the note without a reload.
  permission.state = "denied";
  act(() => permission.onchange?.());
  expect(screen.getByText(/refused access to installed fonts/)).toBeTruthy();
  expect(screen.queryByText(/allow access/)).toBeNull();
  fireEvent.click(screen.getByText("Reset"));
});

// A family whose every file the browser's sanitizer rejects must not sit on "Loading" for good.
test("a family the browser refuses says so", async () => {
  permission.state = "granted";
  act(() => permission.onchange?.());
  await settle();
  render(<FontPicker />);
  const code = screen.getByLabelText("Code font") as HTMLInputElement;
  fireEvent.change(code, { target: { value: "Canela" } });
  await settle();
  expect(screen.getByText(/This browser wouldn't load Canela/)).toBeTruthy();
  fireEvent.click(screen.getByText("Reset"));
});
