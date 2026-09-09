import { useSyncExternalStore } from "react";

import type { FontPrefs } from "./storage";
import {
  LS,
  clearFontOverrides,
  getString,
  readFontDefaults,
  readFontOverrides,
  writeFontDefaults,
  writeFontOverrides,
} from "./storage";

export type FontFamilyKey = "monoFamily" | "sansFamily";

// The face --font-sans starts with in every theme; the mono face is per theme (Theme.mono).
export const SANS_FACE = "Inter";

const MAX_FAMILY_LEN = 200;

function quotesBalanced(v: string): boolean {
  return (v.match(/"/g)?.length ?? 0) % 2 === 0 && (v.match(/'/g)?.length ?? 0) % 2 === 0;
}

// A custom property accepts almost any token sequence, so a broken family isn't rejected on the way
// in — it makes every `font-family: var(--font-mono)` invalid at computed-value time and drops the
// whole app to the browser's default serif. Hence validating before painting, and on read too: the
// value can come from a hand-edited lr.fonts.
export function normalizeFamily(raw: string): string {
  const v = raw.trim();
  if (v === "" || v.length > MAX_FAMILY_LEN) return "";
  if (/[;{}<>]|\/\*/.test(v) || !quotesBalanced(v)) return "";
  if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
    return CSS.supports("font-family", v) ? v : "";
  }
  return v;
}

export interface FontState {
  // This repo's own picks — what the inputs hold. Absent means "follow `inherited`".
  own: FontPrefs;
  // The default across repos (lr.fonts) — what an unset field falls back to.
  inherited: FontPrefs;
}

const TOKENS: Record<FontFamilyKey, { name: string; fallback: string }> = {
  monoFamily: { name: "--font-mono", fallback: "--mono-fallback" },
  sansFamily: { name: "--font-sans", fallback: "--sans-fallback" },
};

// Seeded from lr.repo (the repo useReview restores) so the first paint already carries its fonts.
let repo = getString(LS.repo);
let own: FontPrefs = readFontOverrides(repo);
let inherited: FontPrefs = readFontDefaults();
let state: FontState = { own, inherited };
const listeners = new Set<() => void>();

function paint(): void {
  const style = document.documentElement.style;
  for (const key of Object.keys(TOKENS) as FontFamilyKey[]) {
    const { name, fallback } = TOKENS[key];
    const family = normalizeFamily(own[key] ?? inherited[key] ?? "");
    // Clearing removes the property rather than writing the theme's current face back: an inline
    // copy would outlive the next theme switch and pin the old face.
    if (family === "") style.removeProperty(name);
    else style.setProperty(name, `${family}, var(${fallback})`);
  }
}

function commit(): void {
  state = { own, inherited };
  paint();
  for (const l of listeners) l();
}
paint();

// An empty repo is App's "nothing selected yet" first render, not a repo without picks.
export function setFontsRepo(next: string): void {
  if (next === "" || next === repo) return;
  repo = next;
  own = readFontOverrides(repo);
  commit();
}

// Stores what was typed verbatim — normalizing here would clear the field on an unfinished quote,
// and trimming would eat the space you just typed in "Fira Code". Only `paint` and the store insist.
export function setFontFamily(key: FontFamilyKey, raw: string): void {
  const next: FontPrefs = { ...own };
  if (raw.trim() === "") delete next[key];
  else next[key] = raw;
  own = next;
  writeFontOverrides(repo, own);
  if (repo === "") inherited = readFontDefaults();
  commit();
}

export function resetFonts(): void {
  own = {};
  writeFontOverrides(repo, own);
  if (repo === "") inherited = readFontDefaults();
  commit();
}

// "Default across repos" means it: every repo's saved picks go, this one's included, so they all
// follow the new default instead of keeping a duplicate that stops tracking later changes.
export function saveFontsAsDefault(): void {
  inherited = { ...inherited, ...own };
  own = {};
  writeFontDefaults(inherited);
  clearFontOverrides();
  commit();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getState(): FontState {
  return state;
}

export function useFonts(): FontState {
  return useSyncExternalStore(subscribe, getState);
}
