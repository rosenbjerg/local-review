import { expect, test } from "vitest";

import {
  normalizeFamily,
  resetFonts,
  saveFontsAsDefault,
  setFontFamily,
  setFontOffset,
  setFontsRepo,
} from "./fonts";
import { LS, MAX_FONT_OFFSET, MIN_FONT_OFFSET } from "./storage";

const token = (name: string) => document.documentElement.style.getPropertyValue(name);
const mono = () => token("--font-mono");
const sans = () => token("--font-sans");

// A custom property would happily hold a broken family and only fail where it's used, taking every
// font in the app down to the browser's default with it.
test("a family is taken only when CSS would accept it", () => {
  expect(normalizeFamily("  Berkeley Mono  ")).toBe("Berkeley Mono");
  expect(normalizeFamily('"Fira Code", monospace')).toBe('"Fira Code", monospace');
  expect(normalizeFamily('Bad"')).toBe("");
  expect(normalizeFamily("Inter; color: red")).toBe("");
  expect(normalizeFamily("")).toBe("");
});

test("an override paints the token over the theme's, and clearing removes it again", () => {
  setFontsRepo("/repo-a");
  setFontFamily("monoFamily", "Berkeley Mono");
  expect(mono()).toBe("Berkeley Mono, var(--mono-fallback)");

  // Typed but not yet valid: the field keeps it, the token doesn't take it.
  setFontFamily("monoFamily", 'Berkeley Mono"');
  expect(mono()).toBe("");

  setFontFamily("monoFamily", "");
  expect(mono()).toBe("");
});

// Clearing has to remove the property rather than write the theme's face back inline, or the next
// theme switch would leave the old face pinned.
test("a pick belongs to its repo until it is made the default, which clears the others", () => {
  setFontsRepo("/repo-b");
  setFontFamily("monoFamily", "Fira Code");
  setFontsRepo("/repo-c");
  expect(mono()).toBe("");

  setFontsRepo("/repo-b");
  saveFontsAsDefault();
  expect(JSON.parse(localStorage.getItem(LS.fonts)!)).toEqual({ monoFamily: "Fira Code" });
  expect(JSON.parse(localStorage.getItem(LS.fontsByRepo)!)).toEqual({});

  setFontsRepo("/repo-c");
  expect(mono()).toBe("Fira Code, var(--mono-fallback)");
});

test("reset drops this repo's picks field by field, leaving the default standing", () => {
  setFontsRepo("/repo-d");
  setFontFamily("sansFamily", "IBM Plex Sans");
  expect(sans()).toBe("IBM Plex Sans, var(--sans-fallback)");

  resetFonts();
  expect(sans()).toBe("");
  expect(mono()).toBe("Fira Code, var(--mono-fallback)");
});

// A size pick is an offset, so 0 has to be storable: "this repo stays put though the default moved"
// is a real choice, and Reset is the way back to inheriting.
test("a size offset paints in px, and a zero is a pick rather than an absence", () => {
  setFontsRepo("/repo-e");
  setFontOffset("monoOffset", 2);
  expect(token("--mono-offset")).toBe("2px");

  saveFontsAsDefault();
  setFontsRepo("/repo-f");
  expect(token("--mono-offset")).toBe("2px");

  setFontOffset("monoOffset", 0);
  expect(token("--mono-offset")).toBe("");
  expect(JSON.parse(localStorage.getItem(LS.fontsByRepo)!)["/repo-f"]).toEqual({ monoOffset: 0 });

  resetFonts();
  expect(token("--mono-offset")).toBe("2px");
});

test("an offset is clamped to a range the layout survives", () => {
  setFontsRepo("/repo-g");
  setFontOffset("monoOffset", 99);
  expect(token("--mono-offset")).toBe(`${MAX_FONT_OFFSET}px`);
  setFontOffset("monoOffset", -99);
  expect(token("--mono-offset")).toBe(`${MIN_FONT_OFFSET}px`);
});

// The interface scale is one offset over seven steps, so the whole UI moves together rather than the
// body text drifting away from the labels beside it.
test("the interface offset is a separate axis from the code one", () => {
  setFontsRepo("/repo-h");
  const code = token("--mono-offset");
  setFontOffset("sansOffset", 1);
  expect(token("--sans-offset")).toBe("1px");
  expect(token("--mono-offset")).toBe(code);

  setFontOffset("monoOffset", 3);
  expect(token("--sans-offset")).toBe("1px");
  expect(token("--mono-offset")).toBe("3px");
});
