// Pass over rendered-markdown HTML, mirroring `highlightBlocks`: swap each
// ```mermaid fence for the diagram it describes. Runs *after* highlighting, so
// a fence that fails to parse is left as the colored source Shiki produced.

const NATURAL_WIDTH = { useMaxWidth: false };

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
function mermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then(({ default: m }) => {
      m.initialize({
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
        theme: "dark",
        flowchart: NATURAL_WIDTH,
        sequence: NATURAL_WIDTH,
        class: NATURAL_WIDTH,
        state: NATURAL_WIDTH,
        er: NATURAL_WIDTH,
        gantt: NATURAL_WIDTH,
        journey: NATURAL_WIDTH,
        pie: NATURAL_WIDTH,
      });
      return m;
    });
  }
  return mermaidPromise;
}

const cache = new Map<string, string>();

// Ids are baked into the SVG's internal <style> selectors, so each render needs
// its own or diagrams on one page style each other.
let seq = 0;

export async function renderMermaid(baseHtml: string): Promise<string | null> {
  const doc = new DOMParser().parseFromString(baseHtml, "text/html");
  const blocks = [...doc.querySelectorAll("pre > code.language-mermaid")];
  if (!blocks.length) return null;

  const m = await mermaid();
  let changed = false;
  await Promise.all(
    blocks.map(async (code) => {
      const source = code.textContent ?? "";
      let svg = cache.get(source);
      if (svg === undefined) {
        try {
          ({ svg } = await m.render(`mmd-${seq++}`, source));
        } catch {
          return;
        }
        cache.set(source, svg);
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
