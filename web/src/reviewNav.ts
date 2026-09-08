// Tree-order navigation over the review's files.

// `current` is never returned: the caller just marked it reviewed, and the optimistic update hasn't landed yet.
export function nextUnreviewed(
  paths: string[],
  current: string | null,
  reviewed: Set<string>
): string | null {
  const n = paths.length;
  if (n === 0) return null;
  const start = current ? paths.indexOf(current) : -1;
  for (let i = 1; i <= n; i++) {
    const path = paths[(start + i + n) % n];
    if (path !== current && !reviewed.has(path)) return path;
  }
  return null;
}
