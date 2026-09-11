import { useEffect, useRef, useState } from "react";

type CopyState = "idle" | "ok" | "fail";

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

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    // Resolved before the try, which takes the await and nothing else: the compiler bails
    // on a conditional inside one.
    const value = typeof text === "function" ? text() : text;
    try {
      await navigator.clipboard.writeText(value);
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
