import type { PromptKind } from "./prompts";

// Best-effort localStorage: a throwing store falls back to the caller's default.
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

// Per-repo diff-view axes, keyed by repo alone: they describe how you look at a repo, not a branch or review.
export interface DiffViewPref {
  uncommitted: boolean;
  unstaged: boolean;
}

// `unstaged` only means anything while `uncommitted` is on; normalize so a stored pref can't restore a combination the app never holds.
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

// Per-repo agent-prompt overrides, keyed by repo alone; the volatile values stay placeholders (see prompts.ts).
type PromptOverrides = Partial<Record<PromptKind, string>>;

// Blank reads as absent (and the editor refuses to save one), so the modal always has a default to fall back to.
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

// Drop the repo's entry too once it's empty, so the other kind doesn't read as customised because this one once was.
export function clearPromptOverride(repo: string, kind: PromptKind): void {
  const map = getJSON<Record<string, PromptOverrides>>(LS.agentPromptsByRepo, {});
  const entry = map[repo];
  if (!entry) return;
  delete entry[kind];
  if (Object.keys(entry).length === 0) delete map[repo];
  setJSON(LS.agentPromptsByRepo, map);
}

// Per-repo color theme. `lr.theme`, the global choice this replaced, is the default for a repo with no pick and
// where a pick made with no repo selected goes — which is also the migration. Raw string; theme.ts validates it.
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
