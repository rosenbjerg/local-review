import { useSyncExternalStore } from "react";
import type { CommentType } from "./types";

export type DraftTarget =
  | { kind: "line"; path: string; startLine: number; endLine: number }
  | { kind: "file"; path: string }
  | { kind: "reply"; path: string; commentId: number }
  | { kind: "edit"; path: string; commentId: number };

export interface DraftRef {
  key: string;
  target: DraftTarget;
}

export interface Draft extends DraftRef {
  body: string;
  type: CommentType;
}

export const draftKey = {
  line: (path: string, startLine: number, endLine: number) => `line:${startLine}-${endLine}:${path}`,
  file: (path: string) => `file:${path}`,
  reply: (commentId: number) => `reply:${commentId}`,
  editComment: (commentId: number) => `edit:${commentId}`,
  editReply: (replyId: number) => `edit-reply:${replyId}`,
};

let drafts: ReadonlyMap<string, Draft> = new Map();
const listeners = new Set<() => void>();

function commit(next: ReadonlyMap<string, Draft>) {
  drafts = next;
  for (const l of listeners) l();
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.body === b.body && a.type === b.type && JSON.stringify(a.target) === JSON.stringify(b.target)
  );
}

export function getDraft(key: string): Draft | undefined {
  return drafts.get(key);
}

export function getDrafts(): ReadonlyMap<string, Draft> {
  return drafts;
}

const rangesCache = new Map<string, { key: string; ranges: { start: number; end: number }[] }>();

// Must return the same array while the path's anchors hold, or useSyncExternalStore re-renders forever.
function getLineRanges(path: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  for (const d of drafts.values()) {
    if (d.target.kind === "line" && d.target.path === path) {
      ranges.push({ start: d.target.startLine, end: d.target.endLine });
    }
  }
  const key = ranges.map((r) => `${r.start}-${r.end}`).join(",");
  const cached = rangesCache.get(path);
  if (cached && cached.key === key) return cached.ranges;
  rangesCache.set(path, { key, ranges });
  return ranges;
}

export function useLineDraftRanges(path: string): { start: number; end: number }[] {
  return useSyncExternalStore(subscribe, () => getLineRanges(path));
}

export function putDraft(draft: Draft): void {
  const prev = drafts.get(draft.key);
  if (prev && sameDraft(prev, draft)) return;
  const next = new Map(drafts);
  next.set(draft.key, draft);
  commit(next);
}

export function dropDraft(key: string): void {
  if (!drafts.has(key)) return;
  const next = new Map(drafts);
  next.delete(key);
  commit(next);
}

export function clearDrafts(): void {
  if (drafts.size > 0) commit(new Map());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useDrafts(): ReadonlyMap<string, Draft> {
  return useSyncExternalStore(subscribe, getDrafts);
}
