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
