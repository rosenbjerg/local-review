import type { Comment } from "./types";

export function pathSignal<T extends { path: string }>(signal: T | null, path: string): T | null {
  return signal && signal.path === path ? signal : null;
}

export function commentSignal<T extends number | { id: number }>(signal: T | null, comments: Comment[]): T | null {
  if (signal == null) return null;
  const id = typeof signal === "number" ? signal : signal.id;
  return comments.some((c) => c.id === id) ? signal : null;
}
