import { useEffect, useRef, useState } from "react";

type CopyState = "idle" | "ok" | "fail";

// A button that writes text to the clipboard and reflects the result inline
// (idle → "Copied ✓" / "Copy failed" → back to idle after 1.5s) rather than a
// sticky banner error — a failed copy isn't app-level breakage. `text` may be a
// function so the payload is built lazily at click time from live state.
export function CopyButton({
  text,
  idleLabel,
  className = "btn",
  title,
}: {
  text: string | (() => string);
  idleLabel: string;
  className?: string;
  title?: string;
}) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear a pending reset on unmount (and reuse the ref to collapse overlapping
  // timers from rapid clicks into one).
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
      setState("ok");
    } catch {
      setState("fail");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1500);
  }

  return (
    <button className={className} onClick={copy} title={title}>
      {state === "ok" ? "Copied ✓" : state === "fail" ? "Copy failed" : idleLabel}
    </button>
  );
}
