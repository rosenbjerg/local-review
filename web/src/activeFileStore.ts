// A tiny external store for the "active file" (the one highlighted in the tree).
// Kept out of React state so the scroll-spy can update it as you scroll the diff
// without re-rendering App (and every mounted DiffView) — only the FileExplorer,
// which subscribes via useSyncExternalStore, re-renders. The snapshot is a
// primitive (path | null), so it's inherently stable for useSyncExternalStore.
export type ActiveFileStore = ReturnType<typeof createActiveFileStore>;

export function createActiveFileStore() {
  let path: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => path,
    set: (p: string | null) => {
      if (p === path) return; // no-op (and no notify) when unchanged
      path = p;
      for (const l of listeners) l();
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}
