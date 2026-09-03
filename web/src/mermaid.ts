// Pass over rendered-markdown HTML, mirroring `highlightBlocks`: swap each
// ```mermaid fence for the diagram it describes. Runs *after* highlighting, so
// a fence that fails to parse is left as the colored source Shiki produced.

import type { MermaidConfig } from "mermaid";
import { themeOf, type MermaidTheme, type ThemeId } from "./theme";

const NATURAL_WIDTH = { useMaxWidth: false };

const CONFIG: MermaidConfig = {
  startOnLoad: false,
  // Comment bodies can come from an API agent, so diagram source is
  // untrusted: strict encodes HTML in labels and disables click handlers.
  securityLevel: "strict",
  // Keep labels as SVG <text>. The HTML-label path builds real elements
  // from the (DOMPurify-sanitized) label — and <img> survives that, which
  // mermaid then *awaits the load of*: an outbound fetch to whatever URL
  // the diagram names, from a tool that otherwise never leaves localhost.
  htmlLabels: false,
  // Without this a bad diagram injects mermaid's own error graphic into
  // document.body, outside the markdown container we render into.
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

// The theme mermaid is currently initialized with. Its theme is global config, not
// a render option, so a theme switch re-initializes before the next render.
let configured: MermaidTheme | null = null;

// Keyed by theme + source: the SVG bakes the theme's fills in.
const cache = new Map<string, string>();

// Ids are baked into the SVG's internal <style> selectors, so each render needs
// its own or diagrams on one page style each other.
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
        // A theme switch mid-render re-initialized mermaid under this render, so
        // the SVG may carry the other theme's fills: don't cache it under this key.
        // (The caller's effect was cancelled by the same switch and discards it.)
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
