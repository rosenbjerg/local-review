import { useEffect, useRef, useState } from "react";

export interface RefHover {
  id: number;
  rect: DOMRect;
}

function refFor(target: EventTarget | null): HTMLElement | null {
  const el = target as HTMLElement | null;
  return (el?.closest?.("a.comment-ref") as HTMLElement | null) ?? null;
}

// Delegated document listeners for the `#<id>` links the markdown rule emits (innerHTML, so no React handlers).
export function useCommentRefs(jumpTo: (id: number) => void) {
  const [hovered, setHovered] = useState<RefHover | null>(null);
  // A ref, so a re-created jumpTo doesn't re-subscribe the listeners.
  const jumpRef = useRef(jumpTo);
  useEffect(() => {
    jumpRef.current = jumpTo;
  }, [jumpTo]);

  useEffect(() => {
    let showT: ReturnType<typeof setTimeout> | null = null;
    let hideT: ReturnType<typeof setTimeout> | null = null;
    const clear = () => {
      if (showT) clearTimeout(showT);
      if (hideT) clearTimeout(hideT);
      showT = hideT = null;
    };
    const idOf = (a: HTMLElement) => Number(a.dataset.commentId);
    const show = (a: HTMLElement, immediate: boolean) => {
      clear();
      const open = () => setHovered({ id: idOf(a), rect: a.getBoundingClientRect() });
      if (immediate) open();
      else showT = setTimeout(open, 250);
    };
    const scheduleHide = () => {
      clear();
      hideT = setTimeout(() => setHovered(null), 120);
    };

    const onClick = (e: MouseEvent) => {
      const a = refFor(e.target);
      if (!a) return;
      e.preventDefault();
      const id = idOf(a);
      if (id) jumpRef.current(id);
    };
    const onOver = (e: MouseEvent) => {
      const a = refFor(e.target);
      if (a) show(a, false);
    };
    const onOut = (e: MouseEvent) => {
      if (refFor(e.target)) scheduleHide();
    };
    const onFocusIn = (e: FocusEvent) => {
      const a = refFor(e.target);
      if (a) show(a, true); // keyboard focus: no hover delay
    };
    const onFocusOut = (e: FocusEvent) => {
      if (refFor(e.target)) scheduleHide();
    };
    // A scroll moves the anchor out from under the captured rect — just dismiss.
    const dismiss = () => {
      clear();
      setHovered(null);
    };

    document.addEventListener("click", onClick);
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("scroll", dismiss, true);
    return () => {
      clear();
      document.removeEventListener("click", onClick);
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("scroll", dismiss, true);
    };
  }, []);

  return hovered;
}
