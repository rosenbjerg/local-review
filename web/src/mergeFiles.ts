import type { FileDiff } from "./types";

const serialized = new WeakMap<FileDiff, string>();

function json(file: FileDiff): string {
  const cached = serialized.get(file);
  if (cached !== undefined) return cached;
  const text = JSON.stringify(file);
  serialized.set(file, text);
  return text;
}

// Keyed on both paths: a rename's old path is routinely another file's new path, and either alone pairs the wrong two.
const keyOf = (f: FileDiff) => `${f.newPath}\u0000${f.oldPath}`;

// Carries a file's identity across a refetch when its content is unchanged. The poller fires on mtime,
// so most `diff` pings rebuild a diff that didn't move — and every DiffView prop but `comments` is
// compared by identity, so a fresh object per file re-renders and re-tokenizes every mounted card.
export function mergeFiles(prev: FileDiff[], next: FileDiff[]): FileDiff[] {
  if (prev.length === 0) return next;
  const byKey = new Map<string, FileDiff>();
  for (const f of prev) {
    const key = keyOf(f);
    if (!byKey.has(key)) byKey.set(key, f);
  }
  let unmoved = prev.length === next.length;
  const out = next.map((f, i) => {
    const kept = byKey.get(keyOf(f));
    if (kept && json(kept) === json(f)) {
      if (kept !== prev[i]) unmoved = false;
      return kept;
    }
    unmoved = false;
    return f;
  });
  return unmoved ? prev : out;
}
