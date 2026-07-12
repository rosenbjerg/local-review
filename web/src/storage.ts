// Best-effort localStorage: private-mode/quota/disabled throws fall back to the
// caller's default instead of propagating.
export const LS = {
  leftWidth: "lr.leftWidth",
  rightWidth: "lr.rightWidth",
  baseByRepo: "lr.baseByRepo",
  repo: "lr.repo",
  exportInstructions: "lr.exportInstructions",
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
