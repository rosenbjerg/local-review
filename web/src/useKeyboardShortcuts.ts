import { useEffect, useRef } from "react";

export interface Shortcuts {
  // When false (no review open) all shortcuts are inert.
  enabled: boolean;
  // While any modal is open the shortcuts below are suppressed; only `?` (to close
  // the help overlay) still fires — the Modal shell owns Escape.
  modalOpen: boolean;
  helpOpen: boolean;
  loading: boolean;
  onNextFile: () => void;
  onPrevFile: () => void;
  onNextComment: () => void;
  onPrevComment: () => void;
  onExport: () => void;
  onReload: () => void;
  onOpenHelp: () => void;
  onCloseHelp: () => void;
  onFocusSearch: () => void;
}

// One window keydown listener for the app's single-key shortcuts. A ref holds the
// latest handlers so the listener subscribes once yet never goes stale, avoiding a
// large dependency array. Bails while typing in a field or a modifier is held.
export function useKeyboardShortcuts(opts: Shortcuts) {
  const ref = useRef(opts);
  ref.current = opts;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const o = ref.current;
      if (!o.enabled) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (o.modalOpen) {
        if (o.helpOpen && e.key === "?") {
          e.preventDefault();
          o.onCloseHelp();
        }
        return;
      }
      switch (e.key) {
        case "j":
          e.preventDefault();
          o.onNextFile();
          break;
        case "k":
          e.preventDefault();
          o.onPrevFile();
          break;
        case "n":
          e.preventDefault();
          o.onNextComment();
          break;
        case "p":
          e.preventDefault();
          o.onPrevComment();
          break;
        case "e":
          e.preventDefault();
          o.onExport();
          break;
        case "r":
          if (!o.loading) {
            e.preventDefault();
            o.onReload();
          }
          break;
        case "?":
          e.preventDefault();
          o.onOpenHelp();
          break;
        case "/":
          e.preventDefault();
          o.onFocusSearch();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
