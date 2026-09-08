import { useEffect, useRef } from "react";

export interface Shortcuts {
  enabled: boolean;
  // Suppresses everything but `?` (closing the settings overlay); the Modal shell owns Escape.
  modalOpen: boolean;
  settingsOpen: boolean;
  loading: boolean;
  onNextFile: () => void;
  onPrevFile: () => void;
  onNextComment: () => void;
  onPrevComment: () => void;
  onExport: () => void;
  onReload: () => void;
  onMarkReviewed: () => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onFocusSearch: () => void;
  onToggleFilesPane: () => void;
  onToggleCommentsPane: () => void;
  // An occurrence highlight is live, so Enter steps through its matches.
  hasHighlight: boolean;
  onNextMatch: () => void;
  onPrevMatch: () => void;
  onDismissHighlight: () => void;
}

// One window keydown listener; a ref holds the latest handlers so it subscribes once yet never goes stale.
export function useKeyboardShortcuts(opts: Shortcuts) {
  const ref = useRef(opts);
  useEffect(() => {
    ref.current = opts; // keep latest without re-subscribing the keydown listener
  });

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
          t.isContentEditable ||
          // The whole composer subtree, not just its textarea: the type pills and Cancel/Submit are focusable, and
          // `v` or `e` firing off one of them would act on the review mid-comment.
          !!t.closest(".composer"))
      ) {
        return;
      }
      if (o.modalOpen) {
        if (o.settingsOpen && e.key === "?") {
          e.preventDefault();
          o.onCloseSettings();
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
        case "v":
          e.preventDefault();
          o.onMarkReviewed();
          break;
        case "r":
          if (!o.loading) {
            e.preventDefault();
            o.onReload();
          }
          break;
        case "?":
          e.preventDefault();
          o.onOpenSettings();
          break;
        case "/":
          e.preventDefault();
          o.onFocusSearch();
          break;
        // The bracket keys sit either side of the diff the way the panes do.
        case "[":
          e.preventDefault();
          o.onToggleFilesPane();
          break;
        case "]":
          e.preventDefault();
          o.onToggleCommentsPane();
          break;
        // Only while a highlight is live, and never from a control Enter would otherwise activate.
        case "Enter":
          if (o.hasHighlight && t?.tagName !== "BUTTON" && t?.tagName !== "A") {
            e.preventDefault();
            if (e.shiftKey) o.onPrevMatch();
            else o.onNextMatch();
          }
          break;
        // Not prevented: the browser may still want Escape (stopping a load).
        case "Escape":
          o.onDismissHighlight();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
