import { expect, test } from "vitest";

import {
  normalizeFamily,
  resetFonts,
  saveFontsAsDefault,
  setFontFamily,
  setFontsRepo,
} from "./fonts";
import { LS } from "./storage";

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
