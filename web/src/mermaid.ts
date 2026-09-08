// Swaps ```mermaid fences for diagrams; runs *after* highlighting, so an unparseable fence stays as Shiki's colored source.

import type { MermaidConfig } from "mermaid";
import { themeOf, type MermaidTheme, type ThemeId } from "./theme";

const NATURAL_WIDTH = { useMaxWidth: false };

const CONFIG: MermaidConfig = {
  startOnLoad: false,
  // Diagram source can come from an API agent: strict encodes labels and disables click handlers.
  securityLevel: "strict",
  // SVG <text> labels only: the HTML-label path keeps <img> through sanitization and awaits its load — an outbound fetch.
  htmlLabels: false,
  // Else a bad diagram injects mermaid's error graphic into document.body, outside our container.
  suppressErrorRendering: true,
  flowchart: NATURAL_WIDTH,
  sequence: NATURAL_WIDTH,
  class: NATURAL_WIDTH,
  state: NATURAL_WIDTH,
  er: NATURAL_WIDTH,
  gantt: NATURAL_WIDTH,
  journey: NATURAL_WIDTH,
  pie: NATURAL_WIDTH,
};

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
function mermaid() {
  if (!mermaidPromise) mermaidPromise = import("mermaid").then(({ default: m }) => m);
  return mermaidPromise;
}

// mermaid's theme is global config, not a render option, so a switch re-initializes before the next render.
let configured: MermaidTheme | null = null;

// Keyed by theme + source: the SVG bakes the theme's fills in.
const cache = new Map<string, string>();

// Each SVG's internal <style> selects on its own id, so ids must be unique per page.
let seq = 0;

export async function renderMermaid(baseHtml: string, theme: ThemeId): Promise<string | null> {
  const doc = new DOMParser().parseFromString(baseHtml, "text/html");
  const blocks = [...doc.querySelectorAll("pre > code.language-mermaid")];
  if (!blocks.length) return null;

  const m = await mermaid();
  const want = themeOf(theme).mermaid;
  let changed = false;
  await Promise.all(
    blocks.map(async (code) => {
      const source = code.textContent ?? "";
      const key = `${want}\n${source}`;
      let svg = cache.get(key);
      if (svg === undefined) {
        if (configured !== want) {
          m.initialize({ ...CONFIG, theme: want });
          configured = want;
        }
        try {
          ({ svg } = await m.render(`mmd-${seq++}`, source));
        } catch {
          return;
        }
        // A theme switch mid-render may have recolored this SVG, so don't cache it under this key.
        if (configured === want) cache.set(key, svg);
      }
      const wrapper = doc.createElement("div");
      wrapper.className = "mermaid-diagram";
      wrapper.innerHTML = svg;
      code.parentElement?.replaceWith(wrapper);
      changed = true;
    })
  );
  return changed ? doc.body.innerHTML : null;
}
