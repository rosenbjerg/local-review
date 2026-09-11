import type { ReactNode } from "react";

// Wraps each occurrence of `needle` in a <mark>; the needle arrives already trimmed and lowercased.
export function HighlightMatch({ text, needle }: { text: string; needle: string }) {
  if (!needle) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let i = 0;
  // `while (true)` rather than `for (;;)`, and the key off `parts.length` rather than a
  // counter: an empty for-test and an UpdateExpression each bail the compiler out.
  while (true) {
    const idx = lower.indexOf(needle, i);
    if (idx < 0) {
      parts.push(text.slice(i));
      break;
    }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark key={parts.length} className="search-hl">
        {text.slice(idx, idx + needle.length)}
      </mark>
    );
    i = idx + needle.length;
  }
  return <>{parts}</>;
}
