import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

// useFocusTrap keeps keyboard focus inside a modal while it is open. When
// `active` turns true it remembers the currently-focused element and moves
// focus into the container (an element flagged data-autofocus, else the first
// focusable one); Tab / Shift+Tab then cycle within the container. When `active`
// turns false (the modal closes/unmounts) focus is restored to where it was, so
// the keyboard user lands back on the control that opened the dialog. Attach the
// returned ref to the modal container element.
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );

    // Move focus in — prefer a control that opts in via data-autofocus (e.g. the
    // safe "Cancel" of a destructive dialog), else the first focusable element.
    const initial =
      container.querySelector<HTMLElement>("[data-autofocus]") ?? focusable()[0] ?? container;
    initial.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const els = focusable();
      if (els.length === 0) {
        e.preventDefault();
        return;
      }
      const first = els[0];
      const last = els[els.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last || !container.contains(activeEl)) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [active]);

  return ref;
}
