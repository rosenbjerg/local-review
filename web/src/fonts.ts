import { useSyncExternalStore } from "react";

import type { FontPrefs } from "./storage";
import {
  LS,
  MAX_FONT_OFFSET,
  MIN_FONT_OFFSET,
  clearFontOverrides,
  getString,
  readFontDefaults,
  readFontOverrides,
  writeFontDefaults,
  writeFontOverrides,
} from "./storage";

export type FontFamilyKey = "monoFamily" | "sansFamily";
export type FontOffsetKey = "monoOffset" | "sansOffset";

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

// The CSS generic keywords: always available, and they have to stay unquoted to mean anything.
const KEYWORDS = new Set([
  "monospace",
  "sans-serif",
  "serif",
  "system-ui",
  "ui-monospace",
  "ui-sans-serif",
  "ui-serif",
  "ui-rounded",
  "cursive",
  "fantasy",
  "math",
]);

// Quoting is what keeps `ctx.font` assignable: a bare name with a space is invalid, the assignment
// is dropped, and the probe below then compares the previous font with itself and calls it a match.
export function quoteFamily(name: string): string {
  return KEYWORDS.has(name) ? name : `"${name.replace(/["\\]/g, "")}"`;
}

// The face that actually gets used out of a stack, which is what a warning should name.
export function firstFamilyOf(value: string): string {
  return (value.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "").trim();
}

const PROBE_TEXT = "mmmmmmmmmmlliWWWWWW0O";
const PROBE_GENERICS = ["monospace", "serif", "sans-serif"] as const;
const availability = new Map<string, boolean>();

// One canvas for every probe there will ever be: asking per candidate means a whole list of
// not-implemented errors wherever canvas is missing, and a whole list of elements where it isn't.
let ctxOnce: CanvasRenderingContext2D | null | undefined;
function probeContext(): CanvasRenderingContext2D | null {
  if (ctxOnce === undefined) ctxOnce = document.createElement("canvas").getContext("2d");
  return ctxOnce;
}

// Availability, not syntax. `CSS.supports` only parses, so it says yes to Consolas on a Mac; the way
// to learn whether a face resolves is to render with it and see whether the metrics move off the
// generic behind it. One generic can coincide, so a face counts as present if any of the three does.
export function isFamilyAvailable(name: string): boolean {
  const family = name.trim();
  if (family === "") return false;
  if (KEYWORDS.has(family)) return true;
  const cached = availability.get(family);
  if (cached !== undefined) return cached;

  const ctx = probeContext();
  // No canvas (jsdom, a hardened browser): offer the face rather than hide one that would work.
  if (!ctx) return true;

  const quoted = quoteFamily(family);
  const found = PROBE_GENERICS.some((generic) => {
    ctx.font = `72px ${generic}`;
    const base = ctx.measureText(PROBE_TEXT).width;
    ctx.font = `72px ${quoted}, ${generic}`;
    return ctx.measureText(PROBE_TEXT).width !== base;
  });
  availability.set(family, found);
  return found;
}

export interface FontState {
  // This repo's own picks — what the inputs hold. Absent means "follow `inherited`".
  own: FontPrefs;
  // The default across repos (lr.fonts) — what an unset field falls back to.
  inherited: FontPrefs;
}

const FAMILY_TOKENS: Record<FontFamilyKey, { name: string; fallback: string }> = {
  monoFamily: { name: "--font-mono", fallback: "--mono-fallback" },
  sansFamily: { name: "--font-sans", fallback: "--sans-fallback" },
};

const OFFSET_TOKENS: Record<FontOffsetKey, string> = {
  monoOffset: "--mono-offset",
  sansOffset: "--sans-offset",
};

// Seeded from lr.repo (the repo useReview restores) so the first paint already carries its fonts.
let repo = getString(LS.repo);
let own: FontPrefs = readFontOverrides(repo);
let inherited: FontPrefs = readFontDefaults();
let state: FontState = { own, inherited };
const listeners = new Set<() => void>();

export function offsetOf(state: FontState, key: FontOffsetKey): number {
  return state.own[key] ?? state.inherited[key] ?? 0;
}

function paint(): void {
  const style = document.documentElement.style;
  for (const key of Object.keys(FAMILY_TOKENS) as FontFamilyKey[]) {
    const { name, fallback } = FAMILY_TOKENS[key];
    const family = normalizeFamily(own[key] ?? inherited[key] ?? "");
    // Clearing removes the property rather than writing the theme's current face back: an inline
    // copy would outlive the next theme switch and pin the old face.
    if (family === "") style.removeProperty(name);
    else style.setProperty(name, `${family}, var(${fallback})`);
  }
  for (const key of Object.keys(OFFSET_TOKENS) as FontOffsetKey[]) {
    const offset = offsetOf({ own, inherited }, key);
    // The unit is what makes the calc() valid; see the token's own note in styles.css.
    if (offset === 0) style.removeProperty(OFFSET_TOKENS[key]);
    else style.setProperty(OFFSET_TOKENS[key], `${offset}px`);
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

export function setFontOffset(key: FontOffsetKey, px: number): void {
  own = { ...own, [key]: Math.min(MAX_FONT_OFFSET, Math.max(MIN_FONT_OFFSET, Math.round(px))) };
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
