import { useEffect, useRef, useState, type RefObject } from "react";
import { mapSpansToNodes, matchSpans, normalizeTerm } from "./occurrences";

// TS 5.6's DOM lib types `Highlight` but leaves HighlightRegistry's maplike
// members off the interface.
declare global {
  interface HighlightRegistry {
    set(name: string, highlight: Highlight): void;
    delete(name: string): void;
  }
}

const HIGHLIGHT_NAME = "occ";
const ACTIVE_NAME = "occ-active";

// Hunk headers share the content cell's class but are metadata, not file text.
const LINE_CELL = "tr:not(.row-hunk) > td.line-content";

const supported = typeof CSS !== "undefined" && "highlights" in CSS;

interface Target {
  path: string;
  term: string;
}

// Select a word in a diff line and every other occurrence of it in that file
// lights up, so a variable's uses read at a glance. Painted with the CSS Custom
// Highlight API — ranges over the existing text nodes rather than wrapper
// elements, which keeps it off the DOM entirely and out of the way of the
// per-token spans syntax highlighting renders.
export function useOccurrenceHighlight(enabled: boolean, rootRef: RefObject<HTMLElement | null>) {
  const [target, setTarget] = useState<Target | null>(null);
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(0);
  const [viewMode, setViewMode] = useState<string | null>(null);
  // The ranges live outside React because a repaint replaces them without
  // re-running the effect that owns them, and stepping needs the current set.
  const ranges = useRef<Range[]>([]);
  const active = useRef(0);

  function showActive(i: number): Range | undefined {
    active.current = i;
    setIndex(i);
    const range = ranges.current[i];
    if (range) {
      const highlight = new Highlight(range);
      highlight.priority = 1; // paint the current match over the plain ones
      CSS.highlights.set(ACTIVE_NAME, highlight);
    } else {
      CSS.highlights.delete(ACTIVE_NAME);
    }
    return range;
  }

  function step(delta: number) {
    const n = ranges.current.length;
    if (n === 0) return;
    const range = showActive((active.current + delta + n) % n);
    range?.startContainer.parentElement?.closest("tr")?.scrollIntoView({ block: "center" });
  }

  function clear() {
    setTarget(null);
    // Without this the browser still holds the selection, so the next mouseup or
    // keyup re-derives the same term and the highlight comes straight back.
    window.getSelection()?.removeAllRanges();
  }

  useEffect(() => {
    if (!enabled || !supported) return;
    const read = () =>
      setTarget((prev) => {
        const next = readTarget();
        return prev?.path === next?.path && prev?.term === next?.term ? prev : next;
      });
    const onMouseUp = (e: MouseEvent) => {
      if (e.detail < 3) read(); // a triple-click selects the whole line, not a word
    };
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keyup", read);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keyup", read);
    };
  }, [enabled]);

  useEffect(() => {
    if (!target || !supported) return;
    const card = document.querySelector<HTMLElement>(
      `[data-file-path="${CSS.escape(target.path)}"]`
    );
    if (!card) return;
    active.current = 0;

    let raf = 0;
    let first = true;
    const paint = () => {
      raf = 0;
      const found = buildRanges(card, target.term);
      ranges.current = found;
      setCount(found.length);
      setViewMode(card.dataset.viewMode ?? null);
      if (found.length === 0) CSS.highlights.delete(HIGHLIGHT_NAME);
      else CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...found));
      if (first) {
        first = false;
        active.current = indexOfSelection(found);
      }
      showActive(Math.min(active.current, Math.max(found.length - 1, 0)));
    };
    paint();

    // Highlighting swaps a line's single text node for per-token spans when its
    // grammar finishes loading, which detaches every range built before that.
    // Repainting on any change to the card is what keeps the highlight alive
    // through it — and through a Changed/Full toggle or a refetched diff.
    const mo = new MutationObserver(() => {
      if (!raf) raf = requestAnimationFrame(paint);
    });
    mo.observe(card, {
      childList: true,
      subtree: true,
      characterData: true,
      attributeFilter: ["data-view-mode"],
    });

    // Scrolling the file out of sight drops the highlight. A long file stays
    // intersecting while you scan down it, which is the point.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) setTarget(null);
      },
      { root: rootRef.current }
    );
    io.observe(card);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      mo.disconnect();
      io.disconnect();
      CSS.highlights.delete(HIGHLIGHT_NAME);
      CSS.highlights.delete(ACTIVE_NAME);
    };
  }, [target, rootRef]);

  return {
    term: target?.term ?? null,
    path: target?.path ?? null,
    count,
    index,
    viewMode,
    next: () => step(1),
    prev: () => step(-1),
    clear,
  };
}

// A selection only counts when it starts and ends inside one line's content
// cell: that rules out multi-line drags, the line-number gutters, and text
// selected in a comment thread, all without a separate check.
function readTarget(): Target | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return null;
  const cell = cellOf(sel.anchorNode);
  if (!cell || cell !== cellOf(sel.focusNode)) return null;
  const path = cell.closest<HTMLElement>("[data-file-path]")?.dataset.filePath;
  const term = normalizeTerm(sel.toString());
  if (!path || !term) return null;
  return { path, term };
}

// Park the counter on the occurrence the reader selected rather than the file's
// first, so "3 of 12" says where they are and Enter steps forward from there.
function indexOfSelection(ranges: Range[]): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const at = sel.getRangeAt(0);
  const i = ranges.findIndex((r) => r.compareBoundaryPoints(Range.START_TO_START, at) === 0);
  return i < 0 ? 0 : i;
}

function cellOf(node: Node | null): HTMLElement | null {
  const el = node instanceof Element ? node : node?.parentElement;
  return el?.closest<HTMLElement>(LINE_CELL) ?? null;
}

function buildRanges(card: HTMLElement, term: string): Range[] {
  const out: Range[] = [];
  for (const cell of card.querySelectorAll(LINE_CELL)) {
    const nodes = textNodesIn(cell);
    if (nodes.length === 0) continue;
    const spans = matchSpans(nodes.map((t) => t.data).join(""), term);
    if (spans.length === 0) continue;
    for (const { start, end } of mapSpansToNodes(nodes.map((t) => t.length), spans)) {
      const range = document.createRange();
      range.setStart(nodes[start.node], start.offset);
      range.setEnd(nodes[end.node], end.offset);
      out.push(range);
    }
  }
  return out;
}

function textNodesIn(cell: Element): Text[] {
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, {
    // The +/-/space marker shares the cell with the code; counting it would
    // shift every offset in the line and let a match span the two.
    acceptNode: (node) =>
      node.parentElement?.classList.contains("sign")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const out: Text[] = [];
  while (walker.nextNode()) out.push(walker.currentNode as Text);
  return out;
}
