import { expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { ensureFace } from "./localFonts";
import { isFamilyAvailable, setCodeLigatures, setFontFamily, setFontsRepo, useFonts } from "./fonts";

vi.mock("./localFonts", () => ({ ensureFace: vi.fn(), subscribeLocalFonts: () => () => {} }));

// The probe keeps one context for its lifetime, so this file owns a fresh one: a face measures
// differently only once it has "arrived".
const arrived = new Set<string>();
const ctx = {
  font: "",
  measureText: () => ({ width: [...arrived].some((f) => ctx.font.includes(`"${f}"`)) ? 200 : 100 }),
};
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
  ctx as unknown as CanvasRenderingContext2D
);

const pending = new Map<string, (ok: boolean) => void>();
vi.mocked(ensureFace).mockImplementation(
  (family) => new Promise((resolve) => pending.set(family, resolve))
);

// A pick the browser can't resolve by name is handed to localFonts, and the verdict the probe cached
// before the face existed is dropped once it does — otherwise the warning would outlive the fix.
test("a missing face is asked for, and its verdict is re-taken once it arrives", async () => {
  const { result } = renderHook(() => useFonts());
  setFontsRepo("/repo-local");
  act(() => setFontFamily("monoFamily", "SF Pro"));
  const picked = result.current;
  expect(isFamilyAvailable("SF Pro")).toBe(false);
  expect(ensureFace).toHaveBeenCalledWith("SF Pro");

  arrived.add("SF Pro");
  expect(isFamilyAvailable("SF Pro")).toBe(false);
  await act(async () => pending.get("SF Pro")!(true));
  expect(isFamilyAvailable("SF Pro")).toBe(true);
  expect(result.current).not.toBe(picked);
});

// Bundled faces ship with the app: the one the theme isn't using may not be loaded yet, which the
// probe would read as missing, and the machine's own copy must not be registered over it.
test("a bundled face is never asked for", () => {
  setFontsRepo("/repo-bundled");
  setFontFamily("monoFamily", "JetBrains Mono");
  setFontFamily("sansFamily", "Inter");
  expect(ensureFace).not.toHaveBeenCalledWith("JetBrains Mono");
  expect(ensureFace).not.toHaveBeenCalledWith("Inter");
});

// A no is not remembered by the store either: a face refused while access was denied is asked for
// again on the next repaint, which is what a later grant arrives as.
test("a face that could not be brought in is asked for again next time", async () => {
  setFontsRepo("/repo-retry");
  setFontFamily("monoFamily", "Nope Mono");
  expect(vi.mocked(ensureFace).mock.calls.filter(([f]) => f === "Nope Mono").length).toBe(1);
  await act(async () => pending.get("Nope Mono")!(false));

  setCodeLigatures(false);
  expect(vi.mocked(ensureFace).mock.calls.filter(([f]) => f === "Nope Mono").length).toBe(2);
});
