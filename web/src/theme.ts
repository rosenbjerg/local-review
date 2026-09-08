import { useSyncExternalStore } from "react";
import type { MermaidConfig } from "mermaid";
import { LS, getString, readThemePref, writeThemePref } from "./storage";

// A theme is one entry here plus a `:root[data-theme="<id>"]` token block in styles.css; Shiki and mermaid palettes are named per theme.
export type ThemeId =
  | "github-dark"
  | "github-light"
  | "darcula"
  | "rider-night"
  | "rider-day"
  | "webstorm-dark"
  | "webstorm-light"
  | "material-oceanic";

// The Shiki themes highlight.ts registers — Shiki's own, or a hand-written one under themes/.
export type ShikiTheme =
  | "github-dark"
  | "github-light"
  | "darcula"
  | "rider-night"
  | "rider-day"
  | "webstorm-dark"
  | "webstorm-light"
  // Shiki's own bundled Material Theme, under the name it registers itself with.
  | "material-theme";
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
  { id: "rider-night", label: "JetBrains Rider Night", shiki: "rider-night", mermaid: "dark" },
  { id: "rider-day", label: "JetBrains Rider Day", shiki: "rider-day", mermaid: "default" },
  {
    id: "webstorm-dark",
    label: "JetBrains WebStorm Dark",
    shiki: "webstorm-dark",
    mermaid: "dark",
  },
  {
    id: "webstorm-light",
    label: "JetBrains WebStorm Light",
    shiki: "webstorm-light",
    mermaid: "default",
  },
  { id: "material-oceanic", label: "Material Oceanic", shiki: "material-theme", mermaid: "dark" },
];

// "system" follows the OS (GitHub Dark/Light) live until a theme is picked outright.
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

// A removed or misspelt stored id falls back to the default rather than leaving <html> with a data-theme no block matches.
export function readStoredPref(repo: string): ThemePref {
  const v = readThemePref(repo);
  return isThemePref(v) ? v : DEFAULT_PREF;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

// No matchMedia (jsdom) reads as dark.
function systemTheme(): ThemeId {
  return typeof matchMedia === "function" && !matchMedia(DARK_QUERY).matches
    ? "github-light"
    : "github-dark";
}

export function resolveTheme(pref: ThemePref): ThemeId {
  return pref === "system" ? systemTheme() : pref;
}

// The store lives outside React and owns <html data-theme>, so the attribute and the React value can't disagree.

// Seeded from lr.repo (the repo useReview restores) so the first paint is already that repo's theme.
let repo = getString(LS.repo);
let pref: ThemePref = readStoredPref(repo);
let current: ThemeId = resolveTheme(pref);
const listeners = new Set<() => void>();

function paint(id: ThemeId): void {
  current = id;
  document.documentElement.dataset.theme = id;
  for (const l of listeners) l();
}
paint(current);

// Follow the OS only while the preference is "system".
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

// An empty repo is App's "nothing selected yet" first render, not a repo without a preference; repainting there would flash.
export function setThemeRepo(next: string): void {
  if (next === "" || next === repo) return;
  repo = next;
  pref = readStoredPref(repo);
  paint(resolveTheme(pref));
}

export function setThemePref(next: ThemePref): void {
  if (next === pref) return;
  pref = next;
  writeThemePref(repo, next);
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
