import { useSyncExternalStore } from "react";

import { FACE_FEATURES } from "./fontFeatures";
import type { FontPrefs } from "./storage";
import { getTheme, subscribeTheme, themeOf } from "./theme";
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

// Spacing and punctuation are where font names go wrong: the family really is "JetBrainsMono Nerd
// Font", not the "JetBrains Mono Nerd Font" anyone would type. Matching on this form finds it anyway.
export function normalizeName(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = above;
    }
  }
  return row[b.length];
}

// The nearest face that is actually there, so a name CSS can't resolve says what would work instead.
export function nearestFamily(typed: string, choices: readonly string[]): string {
  const q = normalizeName(typed);
  if (q.length < 4) return "";
  let best = "";
  let score = Infinity;
  for (const choice of choices) {
    const n = normalizeName(choice);
    // A prefix either way is someone most of the way to the right name, not a coincidence.
    const d = n.startsWith(q) || q.startsWith(n) ? Math.abs(n.length - q.length) / 2 : editDistance(q, n);
    if (d < score) {
      score = d;
      best = choice;
    }
  }
  return score <= Math.max(2, Math.floor(q.length / 3)) ? best : "";
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

// Neon is the Monaspace this bundles and the family shares one feature layout, so its table names
// the sets for Argon, Xenon and the rest too — none of which we hold a file for.
const MONASPACE_TABLE = "Monaspace Neon";

// ss06 is Markdown Strings: joining forms for runs longer than a fixed ligature, which is not what
// anyone means by ligatures being on. Every other set is one.
const NOT_A_LIGATURE_SET = new Set(["ss06"]);

export interface LigatureSet {
  tag: string;
  name: string;
}

// The sets a face keeps its ligatures in, named as the font itself names them — see fontFeatures.ts,
// which is read out of the bundled files. Empty for a face that keeps them all in `calt`, which is
// JetBrains Mono, Fira Code and every other one: there they cannot be addressed a group at a time.
export function ligatureSetsFor(face: string): LigatureSet[] {
  if (!/^monaspace\b/i.test(face)) return [];
  return (FACE_FEATURES[MONASPACE_TABLE]?.named ?? [])
    .filter((f) => f.tag.startsWith("ss") && !NOT_A_LIGATURE_SET.has(f.tag))
    // The font prefixes its own tag onto the name ("SS03: Arrows"), which a label shouldn't repeat.
    .map(({ tag, name }) => ({ tag, name: name.replace(/^SS\d\d:\s*/, "") }));
}

const LIGATURES_OFF = ['"liga" 0', '"clig" 0', '"dlig" 0'];

// Without its sets Monaspace shows eight ligatures where JetBrains Mono shows its whole set — the
// same code rendering differently per theme. And `calt` is where JetBrains Mono, Fira Code and the
// rest keep their ligatures, but in Monaspace it is texture healing, which a ligature switch has no
// business turning off — one fact, so both branches ask the same question.
function featuresFor(face: string, ligatures: boolean, off: readonly string[]): string {
  const sets = ligatureSetsFor(face);
  if (!ligatures) return (sets.length > 0 ? LIGATURES_OFF : [...LIGATURES_OFF, '"calt" 0']).join(", ");
  if (sets.length === 0) return "";
  const on = sets.filter((s) => !off.includes(s.tag));
  const tags = on.map((s) => `"${s.tag}" 1`);
  // `liga` is a ninth source of ligatures in its own right — its lookups are disjoint from every
  // stylistic set's, so it would go on drawing an arrow after Arrows was unchecked. It is left alone
  // while every group is on, so a switch nobody has touched renders exactly as it always has, and
  // silenced the moment one goes off, which is what makes that checkbox mean anything.
  return (on.length < sets.length ? [...LIGATURES_OFF, ...tags] : tags).join(", ");
}

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

// The default lives here alone: paint and the checkbox both read it, and a second copy would drift.
export function codeLigaturesOn(state: FontState): boolean {
  return state.own.codeLigatures ?? state.inherited.codeLigatures ?? true;
}

// Absent means every group is on: a face that grows a set shows it, rather than staying dark until
// someone opts in. Empty is unreachable — the store drops the key rather than saving one.
export function ligatureSetsOffOf(state: FontState): readonly string[] {
  return state.own.ligatureSetsOff ?? state.inherited.ligatureSetsOff ?? [];
}

// The face code is actually rendered in: an override when it holds up, else the theme's own. Exported
// for the picker, which needs the same answer paint does — a second copy of this would drift.
export function monoFace(): string {
  const picked = firstFamilyOf(normalizeFamily(own.monoFamily ?? inherited.monoFamily ?? ""));
  return picked === "" ? themeOf(getTheme()).mono : picked;
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

  const prefs = { own, inherited };
  const features = featuresFor(monoFace(), codeLigaturesOn(prefs), ligatureSetsOffOf(prefs));
  if (features === "") style.removeProperty("--code-features");
  else style.setProperty("--code-features", features);
}

// With no family override the code face is the theme's, so a theme switch can change which features
// apply. Nothing in FontState moves, so this repaints without waking the React consumers.
subscribeTheme(paint);

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

export function setCodeLigatures(on: boolean): void {
  own = { ...own, codeLigatures: on };
  writeFontOverrides(repo, own);
  if (repo === "") inherited = readFontDefaults();
  commit();
}

// Stores the groups that are off rather than the ones that are on, and drops the key once none are:
// an absent field inherits, which is the rule every other font pref follows.
export function setLigatureSet(tag: string, on: boolean): void {
  const current = ligatureSetsOffOf({ own, inherited });
  const next = on ? current.filter((t) => t !== tag) : [...new Set([...current, tag])].sort();
  const prefs: FontPrefs = { ...own };
  if (next.length === 0) delete prefs.ligatureSetsOff;
  else prefs.ligatureSetsOff = next;
  own = prefs;
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
