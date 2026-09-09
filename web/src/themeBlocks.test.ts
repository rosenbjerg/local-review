import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

import { THEMES } from "./theme";

// Read off disk: vitest replaces .css imports with empty modules (query or not).
const css = readFileSync(join(__dirname, "styles.css"), "utf8");

// The attribute can appear anywhere in the selector list, since a block answers to a swatch row too.
function blockFor(id: string): string | null {
  const m = css.match(new RegExp(`\\[data-theme="${id}"\\][^{}]*\\{([^}]*)\\}`));
  return m ? m[1] : null;
}

function tokensOf(block: string): string[] {
  return [...block.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]).sort();
}

// A theme is a full restatement of the default block. A token missing from one theme
// wouldn't fall back to the default's value — custom properties inherit from the
// parent element, and <html> has none — so every rule using it would paint the
// browser's initial color, in that theme only. Same for a THEMES entry with no block:
// the bare :root would paint it github-dark under another name.
test("every theme has a token block, and every block defines every token", () => {
  const base = blockFor("github-dark");
  expect(base).not.toBeNull();
  const want = tokensOf(base!);
  expect(want.length).toBeGreaterThan(20);

  for (const t of THEMES) {
    const block = blockFor(t.id);
    expect(block, `${t.id} has no :root[data-theme] block`).not.toBeNull();
    expect(tokensOf(block!), `${t.id} defines a different token set`).toEqual(want);
    expect(block, `${t.id} sets no color-scheme`).toMatch(/color-scheme:\s*(dark|light)\s*;/);
  }
});

// Theme.mono names the face the block's --font-mono starts with, so the font picker can say what an
// empty override falls back to. Nothing else holds the two together.
test("every theme's declared mono face is the one its block starts with", () => {
  for (const t of THEMES) {
    const block = blockFor(t.id);
    const face = block?.match(/--font-mono:\s*"([^"]+)"/);
    expect(face, `${t.id} has no quoted --font-mono face`).not.toBeNull();
    expect(face![1], `${t.id} names a different face in THEMES`).toBe(t.mono);
  }
});

// The picker paints each row by handing it the theme's id, which only works while the token blocks
// answer to something other than :root. Losing that selector would silently flatten every row.
test("every theme block answers to a swatch row, not only to :root", () => {
  for (const t of THEMES) {
    expect(css.includes(`.theme-option[data-theme="${t.id}"]`), `${t.id} has no swatch selector`).toBe(
      true
    );
  }
});
