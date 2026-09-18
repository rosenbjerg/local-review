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

export function findFamily(families: readonly string[], typed: string): string | undefined {
  const q = normalizeName(typed);
  return q === "" ? undefined : families.find((f) => normalizeName(f) === q);
}
