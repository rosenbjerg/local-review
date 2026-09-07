import { useEffect, useState, type KeyboardEvent, type RefObject } from "react";

interface Options {
  // Rows in the list as currently shown (after filtering).
  length: number;
  // Enter on a row.
  onPick: (index: number) => void;
  // The list's container: the row to follow into view is its `[data-idx="<i>"]`
  // descendant, so headings interleaved with the rows can't put the index off.
  listRef: RefObject<HTMLElement | null>;
  // Whether the list is on screen. Following the row into view is keyed on it, so a
  // dropdown scrolls to the current pick when it opens, not only on the next move.
  open?: boolean;
}

// The keyboard half of a filtered list: which row is active, arrows moving it (and
// staying in range as the filter shrinks the list), Enter picking it, and the row
// following the keyboard into view. The combobox dropdown and the add-file picker
// each had a copy; what differs between them (opening on ArrowDown, Escape) stays
// in the caller, which asks `onKeyDown` whether the key was taken first.
export function useListNavigation({ length, onPick, listRef, open = true }: Options) {
  const [active, setActive] = useState(0);

  // Keep the active row in range as filtering shrinks the list.
  useEffect(() => {
    setActive((a) => (length === 0 ? 0 : Math.min(a, length - 1)));
  }, [length]);

  // Follow the keyboard selection into view.
  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, listRef]);

  // Returns whether the key was one of the list's, so the caller can fall through
  // to its own handling for the rest.
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
