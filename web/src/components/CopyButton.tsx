import { useEffect, useRef, useState } from "react";

type CopyState = "idle" | "ok" | "fail";

// Clipboard button that reflects the result inline (idle → "Copied ✓" / "Copy
// failed" → idle after 1.5s) rather than a sticky error. `text` may be a
// function so the payload is built lazily at click time.
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

  // Clear a pending reset on unmount; the ref also collapses rapid-click timers.
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
