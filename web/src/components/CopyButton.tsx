import { useEffect, useRef, useState } from "react";
import { IconCheck, IconCopy, IconX } from "./icons";

type CopyState = "idle" | "ok" | "fail";

export function CopyButton({
  text,
  idleLabel,
  className = "btn",
  title,
  icon = false,
  iconSize = 14,
}: {
  text: string | (() => string);
  idleLabel: string;
  className?: string;
  title?: string;
  icon?: boolean;
  iconSize?: number;
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

  const outcome = state === "ok" ? "Copied ✓" : state === "fail" ? "Copy failed" : null;

  if (!icon) {
    return (
      <button className={className} onClick={copy} title={title}>
        {outcome ?? idleLabel}
      </button>
    );
  }

  // idleLabel stays the accessible name through every state, so the icon's meaning rides on
  // the title and the colour; swapping it would rename the control mid-interaction.
  return (
    <button
      className={`${className}${state === "fail" ? " copy-fail" : ""}`}
      onClick={copy}
      title={outcome ?? title ?? idleLabel}
      aria-label={idleLabel}
    >
      {state === "ok" ? (
        <IconCheck size={iconSize} />
      ) : state === "fail" ? (
        <IconX size={iconSize} />
      ) : (
        <IconCopy size={iconSize} />
      )}
    </button>
  );
}
