import { useSyncExternalStore } from "react";
import type { Layout } from "./diffRows";
import { LS, getString, setString } from "./storage";

let current: Layout = getString(LS.diffLayout) === "split" ? "split" : "unified";
const listeners = new Set<() => void>();

export function getDefaultLayout(): Layout {
  return current;
}

export function setDefaultLayout(next: Layout): void {
  if (next === current) return;
  current = next;
  setString(LS.diffLayout, next);
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useDefaultLayout(): Layout {
  return useSyncExternalStore(subscribe, getDefaultLayout);
}
