import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { LS, getNumber, setNumber } from "./storage";
import { clamp } from "./util";

// Owns the two resizable panel widths and the drag/keyboard resize handlers.
// During a drag it writes grid-template-columns straight to the DOM (via mainRef)
// — a per-mousemove setState would re-render every mounted diff — and only commits
// the width to state on release.
export function usePanelResize() {
  const [leftW, setLeftW] = useState(() => getNumber(LS.leftWidth, 260));
  const [rightW, setRightW] = useState(() => getNumber(LS.rightWidth, 380));
  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNumber(LS.leftWidth, leftW);
  }, [leftW]);
  useEffect(() => {
    setNumber(LS.rightWidth, rightW);
  }, [rightW]);

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
        mainRef.current.style.gridTemplateColumns = `${finalLeft}px 6px 1fr 6px ${finalRight}px`;
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

  return { leftW, rightW, mainRef, startResize, onResizeKey };
}
