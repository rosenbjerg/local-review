import { useEffect, useState, type KeyboardEvent, type RefObject } from "react";

interface Options {
  length: number;
  onPick: (index: number) => void;
  // The row to follow into view is its `[data-idx="<i>"]` descendant, so interleaved headings can't put the index off.
  listRef: RefObject<HTMLElement | null>;
  // Following into view is keyed on it, so a dropdown scrolls to the current pick when it opens.
  open?: boolean;
}

// The keyboard half of a filtered list; the caller asks onKeyDown whether the key was taken before handling its own.
export function useListNavigation({ length, onPick, listRef, open = true }: Options) {
  const [active, setActive] = useState(0);

  // Keep the active row in range as filtering shrinks the list.
  useEffect(() => {
    setActive((a) => (length === 0 ? 0 : Math.min(a, length - 1)));
  }, [length]);

  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, listRef]);

  function onKeyDown(e: KeyboardEvent): boolean {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => Math.min(a + 1, Math.max(length - 1, 0)));
        return true;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
        return true;
      case "Enter":
        if (active < length) {
          e.preventDefault();
          onPick(active);
        }
        return true;
      default:
        return false;
    }
  }

  return { active, setActive, onKeyDown };
}
