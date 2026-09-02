export function relativeTime(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function absoluteTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : "";
}

// The backend leaves updated_at == created_at until a real body/type edit —
// resolve deliberately doesn't bump it — so updatedAt > createdAt means edited.
export function wasEdited(createdAt: string, updatedAt: string): boolean {
  if (!createdAt || !updatedAt) return false;
  const c = new Date(createdAt).getTime();
  const u = new Date(updatedAt).getTime();
  if (!Number.isFinite(c) || !Number.isFinite(u)) return false;
  return u > c;
}

// Day-granular relative date, for a value ordered by its date rather than its time
// (the repo picker's activity). It must not be sub-day precise: two repos worked on
// the same day are ordered alphabetically, so "2h ago" above "5h ago" would read as
// a broken sort. Takes a YYYY-MM-DD date, parsed as local — Date("2026-09-02")
// parses as UTC midnight, which is the previous day west of Greenwich.
export function relativeDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return "";
  const then = new Date(y, m - 1, d);
  if (!Number.isFinite(then.getTime())) return "";
  const now = new Date();
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - then.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
