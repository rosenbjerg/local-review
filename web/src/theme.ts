import { useSyncExternalStore } from "react";
import type { MermaidConfig } from "mermaid";
import { LS, getString, setString } from "./storage";

// A theme is one entry here plus a `:root[data-theme="<id>"]` token block in
// styles.css. The tokens carry every color the UI itself paints; the two renderers
// that bring their own palettes — Shiki (syntax token colors) and mermaid (diagram
// fills) — are mapped per theme by name, so a theme is complete only when all three
// agree.
export type ThemeId = "github-dark" | "github-light" | "darcula";

// The Shiki themes highlight.ts bundles — Shiki's own, or a hand-written one under
// themes/. A name added here without its registration there is a compile error, not
// a blank highlight.
export type ShikiTheme = "github-dark" | "github-light" | "darcula";
export type MermaidTheme = NonNullable<MermaidConfig["theme"]>;

export interface Theme {
  id: ThemeId;
  label: string;
  shiki: ShikiTheme;
  mermaid: MermaidTheme;
}

export const THEMES: readonly Theme[] = [
  { id: "github-dark", label: "GitHub Dark", shiki: "github-dark", mermaid: "dark" },
  { id: "github-light", label: "GitHub Light", shiki: "github-light", mermaid: "default" },
  { id: "darcula", label: "JetBrains Darcula", shiki: "darcula", mermaid: "dark" },
];

// What the picker stores: a theme, or "system" — GitHub Dark or Light by the OS
// setting, followed live until a theme is picked outright. It's the default, so a
// reviewer who never opens the picker gets the scheme their desktop already uses.
export type ThemePref = ThemeId | "system";
export const DEFAULT_PREF: ThemePref = "system";

export function isThemeId(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v);
}

export function isThemePref(v: unknown): v is ThemePref {
  return v === "system" || isThemeId(v);
}

export function themeOf(id: ThemeId): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

// A stored value counts only if it names a theme or "system": a removed or misspelt
// id falls back to the default rather than leaving <html> with a data-theme no token
// block matches.
export function readStoredPref(): ThemePref {
  const v = getString(LS.theme);
  return isThemePref(v) ? v : DEFAULT_PREF;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

// No answer reads as dark: jsdom has no matchMedia, and neither does any browser
// we'd want to paint light unasked.
function systemTheme(): ThemeId {
  return typeof matchMedia === "function" && !matchMedia(DARK_QUERY).matches
    ? "github-light"
    : "github-dark";
}

export function resolveTheme(pref: ThemePref): ThemeId {
  return pref === "system" ? systemTheme() : pref;
}

// The active theme lives outside React. DiffView, Markdown and the picker each read
// it where they are, so it needn't be threaded from App through every card and every
// rendered body — and the store owns the <html> attribute, so the two can't disagree.
let pref: ThemePref = readStoredPref();
let current: ThemeId = resolveTheme(pref);
const listeners = new Set<() => void>();

function paint(id: ThemeId): void {
  current = id;
  document.documentElement.dataset.theme = id;
  for (const l of listeners) l();
}
paint(current);

// Follow the OS only while the preference is "system": a theme picked outright stays
// put when the desktop flips.
if (typeof matchMedia === "function") {
  matchMedia(DARK_QUERY).addEventListener("change", () => {
    if (pref === "system") paint(systemTheme());
  });
}

export function getTheme(): ThemeId {
  return current;
}

export function getThemePref(): ThemePref {
  return pref;
}

// One notification serves both snapshots: a consumer whose own (theme or pref)
// didn't change bails out of the re-render.
export function setThemePref(next: ThemePref): void {
  if (next === pref) return;
  pref = next;
  setString(LS.theme, next);
  paint(resolveTheme(next));
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// The resolved theme — what the tokens, Shiki and mermaid render.
export function useTheme(): ThemeId {
  return useSyncExternalStore(subscribe, getTheme);
}

// The stored choice — what the picker shows.
export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, getThemePref);
}
