// Human-friendly timestamps for comment/reply meta lines.

// relativeTime turns an ISO timestamp into a compact "3m ago" / "2h ago" /
// "5d ago" string, falling back to a short absolute date past a week. Returns
// "" for empty/unparseable input (older rows can carry a blank timestamp).
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

// absoluteTime is the full local timestamp, shown on hover behind relativeTime.
export function absoluteTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : "";
}

// wasEdited reports whether a comment/reply body was changed after creation.
// The backend keeps updated_at == created_at until an actual body/type edit
// (resolving a thread no longer bumps it), so a later updated_at is a genuine
// edit.
export function wasEdited(createdAt: string, updatedAt: string): boolean {
  if (!createdAt || !updatedAt) return false;
  const c = new Date(createdAt).getTime();
  const u = new Date(updatedAt).getTime();
  if (!Number.isFinite(c) || !Number.isFinite(u)) return false;
  return u > c;
}
