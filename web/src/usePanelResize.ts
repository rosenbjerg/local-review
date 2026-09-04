import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { LS, getBool, getNumber, setBool, setNumber } from "./storage";
import { clamp } from "./util";

// The width a collapsed pane keeps: enough for the vertical reopen button (see
// PaneRail), and never zero — a pane with no edge left on screen is a pane the
// reviewer can't find their way back to.
export const RAIL_WIDTH = 28;

// The grid the layout is: two panes, each behind a 6px resizer track.
function columns(left: number, right: number): string {
  return `${left}px 6px 1fr 6px ${right}px`;
}

// Owns the two resizable panel widths, whether each pane is open, and the
// drag/keyboard resize handlers. During a drag it writes grid-template-columns
// straight to the DOM (via mainRef) — a per-mousemove setState would re-render
// every mounted diff — and only commits the width to state on release. A
// collapsed pane keeps its stored width, so reopening restores it rather than
// snapping to the default.
export function usePanelResize() {
  const [leftW, setLeftW] = useState(() => getNumber(LS.leftWidth, 260));
  const [rightW, setRightW] = useState(() => getNumber(LS.rightWidth, 380));
  const [leftOpen, setLeftOpen] = useState(() => getBool(LS.leftOpen, true));
  const [rightOpen, setRightOpen] = useState(() => getBool(LS.rightOpen, true));
  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNumber(LS.leftWidth, leftW);
  }, [leftW]);
  useEffect(() => {
    setNumber(LS.rightWidth, rightW);
  }, [rightW]);
  useEffect(() => {
    setBool(LS.leftOpen, leftOpen);
  }, [leftOpen]);
  useEffect(() => {
    setBool(LS.rightOpen, rightOpen);
  }, [rightOpen]);

  const gridTemplateColumns = columns(leftOpen ? leftW : RAIL_WIDTH, rightOpen ? rightW : RAIL_WIDTH);

  function startResize(e: ReactMouseEvent, side: "left" | "right") {
    e.preventDefault();
    const startX = e.clientX;
    const startLeft = leftW;
    const startRight = rightW;
    let finalLeft = startLeft;
    let finalRight = startRight;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      if (side === "left") finalLeft = clamp(startLeft + dx, 160, 560);
      else finalRight = clamp(startRight - dx, 220, 640);
      if (mainRef.current) {
        // A collapsed pane holds the rail width whatever its stored width is —
        // the other side's resizer is still draggable while it's shut.
        mainRef.current.style.gridTemplateColumns = columns(
          leftOpen ? finalLeft : RAIL_WIDTH,
          rightOpen ? finalRight : RAIL_WIDTH
        );
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setLeftW(finalLeft);
      setRightW(finalRight);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }

  function onResizeKey(e: ReactKeyboardEvent, side: "left" | "right") {
    const step = e.shiftKey ? 40 : 12;
    let delta = 0;
    if (e.key === "ArrowLeft") delta = -step;
    else if (e.key === "ArrowRight") delta = step;
    else return;
    e.preventDefault();
    if (side === "left") setLeftW((w) => clamp(w + delta, 160, 560));
    else setRightW((w) => clamp(w - delta, 220, 640));
  }

  return {
    leftW,
    rightW,
    leftOpen,
    rightOpen,
    toggleLeft: () => setLeftOpen((v) => !v),
    toggleRight: () => setRightOpen((v) => !v),
    gridTemplateColumns,
    mainRef,
    startResize,
    onResizeKey,
  };
}
