import type { PromptKind } from "./prompts";

// Best-effort localStorage: private-mode/quota/disabled throws fall back to the
// caller's default instead of propagating.
export const LS = {
  leftWidth: "lr.leftWidth",
  rightWidth: "lr.rightWidth",
  leftOpen: "lr.leftOpen",
  rightOpen: "lr.rightOpen",
  baseByRepo: "lr.baseByRepo",
  diffViewByRepo: "lr.diffViewByRepo",
  repo: "lr.repo",
  exportInstructions: "lr.exportInstructions",
  commentSort: "lr.commentSort",
  agentPromptsByRepo: "lr.agentPromptsByRepo",
  theme: "lr.theme",
  themeByRepo: "lr.themeByRepo",
} as const;

export function getString(key: string, def = ""): string {
  try {
    return localStorage.getItem(key) ?? def;
  } catch {
    return def;
  }
}

export function setString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // best-effort
  }
}

export function getNumber(key: string, def: number): number {
  const raw = getString(key);
  if (raw === "") return def;
  const v = Number(raw);
  return Number.isFinite(v) ? v : def;
}

export function setNumber(key: string, value: number): void {
  setString(key, String(value));
}

export function getBool(key: string, def = false): boolean {
  const raw = getString(key);
  return raw === "" ? def : raw === "true";
}

export function setBool(key: string, value: boolean): void {
  setString(key, String(value));
}

export function getJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function setJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort
  }
}

// Per-repo remembered base branch, under lr.baseByRepo (a { repo: base } map).
export function readBasePref(repo: string): string {
  const v = getJSON<Record<string, string>>(LS.baseByRepo, {})[repo];
  return typeof v === "string" ? v : "";
}

export function writeBasePref(repo: string, base: string): void {
  const map = getJSON<Record<string, string>>(LS.baseByRepo, {});
  map[repo] = base;
  setJSON(LS.baseByRepo, map);
}

// Per-repo remembered diff-view axes, under lr.diffViewByRepo (a { repo: pref } map).
// Keyed by repo alone: the axes describe how you like to look at a repo, not a
// property of the branch or review being read.
export interface DiffViewPref {
  uncommitted: boolean;
  unstaged: boolean;
}

// `unstaged` is only meaningful while `uncommitted` is on, and the hook resets it to
// true whenever that goes off — normalize on both sides so a stored (or hand-edited)
// pref can't restore a combination the app itself would never hold.
function normalizeDiffView(v: unknown): DiffViewPref {
  const o = (v ?? {}) as Partial<DiffViewPref>;
  const uncommitted = o.uncommitted === true;
  return { uncommitted, unstaged: uncommitted ? o.unstaged !== false : true };
}

export function readDiffViewPref(repo: string): DiffViewPref {
  return normalizeDiffView(getJSON<Record<string, unknown>>(LS.diffViewByRepo, {})[repo]);
}

export function writeDiffViewPref(repo: string, pref: DiffViewPref): void {
  const map = getJSON<Record<string, DiffViewPref>>(LS.diffViewByRepo, {});
  map[repo] = normalizeDiffView(pref);
  setJSON(LS.diffViewByRepo, map);
}

// Per-repo agent-prompt overrides, under lr.agentPromptsByRepo (a { repo: { kind:
// template } } map). Keyed by repo alone, like the base and diff-view prefs: an edited
// prompt is how you brief an agent about a repo, not about one review — which is also
// why the volatile values stay placeholders (see prompts.ts).
type PromptOverrides = Partial<Record<PromptKind, string>>;

// A stored template counts only if it is a non-blank string. Blank reads as absent
// (and the editor refuses to save one), so a hand-edited or truncated entry can't
// leave the modal showing an empty box with no default left to fall back to.
export function readPromptOverride(repo: string, kind: PromptKind): string | null {
  const map = getJSON<Record<string, PromptOverrides>>(LS.agentPromptsByRepo, {});
  const v = map[repo]?.[kind];
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

export function writePromptOverride(repo: string, kind: PromptKind, template: string): void {
  const map = getJSON<Record<string, PromptOverrides>>(LS.agentPromptsByRepo, {});
  map[repo] = { ...map[repo], [kind]: template };
  setJSON(LS.agentPromptsByRepo, map);
}

// Drop the override (back to the built-in template), and the repo's entry with it once
// it holds nothing: the other prompt kind must not read as customised because this one
// once was, and an accreting map of empty objects is a stored value that says
// "edited here" when nothing is.
export function clearPromptOverride(repo: string, kind: PromptKind): void {
  const map = getJSON<Record<string, PromptOverrides>>(LS.agentPromptsByRepo, {});
  const entry = map[repo];
  if (!entry) return;
  delete entry[kind];
  if (Object.keys(entry).length === 0) delete map[repo];
  setJSON(LS.agentPromptsByRepo, map);
}

// Per-repo remembered color theme, under lr.themeByRepo (a { repo: pref } map).
// Keyed by repo alone, like the base and diff-view prefs: a theme is picked for the
// code you're looking at — the JetBrains one for a repo you edit in Rider, GitHub
// Dark for the rest — not for a branch or a review.
//
// `lr.theme`, the single global choice this replaced, is now the *default*: what a
// repo with no pick of its own shows, and where a pick made before any repo is
// selected goes. That doubles as the migration — a theme chosen before the split
// keeps applying everywhere until a repo is themed outright. The value stays a raw
// string here; theme.ts validates it, since the type it has to name lives there.
export function readThemePref(repo: string): string {
  const v = getJSON<Record<string, string>>(LS.themeByRepo, {})[repo];
  return typeof v === "string" ? v : getString(LS.theme);
}

export function writeThemePref(repo: string, pref: string): void {
  if (repo === "") {
    setString(LS.theme, pref);
    return;
  }
  const map = getJSON<Record<string, string>>(LS.themeByRepo, {});
  map[repo] = pref;
  setJSON(LS.themeByRepo, map);
}
