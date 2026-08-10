// Best-effort localStorage: private-mode/quota/disabled throws fall back to the
// caller's default instead of propagating.
export const LS = {
  leftWidth: "lr.leftWidth",
  rightWidth: "lr.rightWidth",
  baseByRepo: "lr.baseByRepo",
  diffViewByRepo: "lr.diffViewByRepo",
  repo: "lr.repo",
  exportInstructions: "lr.exportInstructions",
  commentSort: "lr.commentSort",
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
