import { useSyncExternalStore } from "react";
import type { MermaidConfig } from "mermaid";
import { LS, getString, setString } from "./storage";

// A theme is one entry here plus a `:root[data-theme="<id>"]` token block in
// styles.css. The tokens carry every color the UI itself paints; the two renderers
// that bring their own palettes — Shiki (syntax token colors) and mermaid (diagram
// fills) — are mapped per theme by name, so a theme is complete only when all three
// agree.
export type ThemeId = "github-dark" | "github-light";

// The Shiki themes highlight.ts bundles. A name added here without its JSON
// registered there is a compile error, not a blank highlight.
export type ShikiTheme = "github-dark" | "github-light";
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
];

export const DEFAULT_THEME: ThemeId = "github-dark";

export function isThemeId(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v);
}

export function themeOf(id: ThemeId): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

// A stored value counts only if it names a theme: a removed or misspelt id falls back
// to the default rather than leaving <html> with a data-theme no token block matches.
export function readStoredTheme(): ThemeId {
  const v = getString(LS.theme);
  return isThemeId(v) ? v : DEFAULT_THEME;
}

// The active theme lives outside React. DiffView, Markdown and the picker each read
// it where they are, so it needn't be threaded from App through every card and every
// rendered body — and the store owns the <html> attribute, so the two can't disagree.
let current: ThemeId = readStoredTheme();
const listeners = new Set<() => void>();

function apply(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
}
apply(current);

export function getTheme(): ThemeId {
  return current;
}

export function setTheme(id: ThemeId): void {
  if (id === current) return;
  current = id;
  apply(id);
  setString(LS.theme, id);
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useTheme(): ThemeId {
  return useSyncExternalStore(subscribe, getTheme);
}
