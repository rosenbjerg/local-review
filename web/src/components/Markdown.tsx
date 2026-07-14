import { useEffect, useMemo, useState } from "react";
import MarkdownIt from "markdown-it";
import { langForInfo, tokenize } from "../highlight";

// html:false — bodies are injected via dangerouslySetInnerHTML, so raw HTML must
// stay escaped.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

// This preview renders inside a nav <button>: links would be invalid nesting and
// hijack the jump click, so link/image syntax collapses to plain text.
const inlineMd = new MarkdownIt({ html: false, linkify: false, breaks: false });
inlineMd.renderer.rules.link_open = () => "";
inlineMd.renderer.rules.link_close = () => "";
inlineMd.renderer.rules.image = (tokens, idx) => inlineMd.utils.escapeHtml(tokens[idx].content);

// Second pass over the rendered HTML: swap each fenced block's plain text for
// Shiki's github-dark colored spans (same tokens the diff view renders). Async
// because grammars load lazily; the plain text shows until they resolve.
async function highlightBlocks(baseHtml: string): Promise<string | null> {
  const doc = new DOMParser().parseFromString(baseHtml, "text/html");
  const blocks = [...doc.querySelectorAll("pre > code[class*='language-']")];
  let changed = false;
  await Promise.all(
    blocks.map(async (code) => {
      const cls = [...code.classList].find((c) => c.startsWith("language-"));
      const lang = cls && langForInfo(cls.slice("language-".length));
      if (!lang) return;
      const lines = await tokenize(code.textContent ?? "", lang);
      if (!lines) return;
      code.replaceChildren();
      lines.forEach((line, i) => {
        if (i > 0) code.append("\n");
        for (const t of line) {
          const span = doc.createElement("span");
          span.style.color = t.color ?? "";
          span.textContent = t.content;
          code.append(span);
        }
      });
      changed = true;
    })
  );
  return changed ? doc.body.innerHTML : null;
}

export function Markdown({
  source,
  className,
  inline = false,
}: {
  source: string;
  className?: string;
  inline?: boolean;
}) {
  const base = useMemo(
    () => (inline ? inlineMd.renderInline(source) : md.render(source)),
    [source, inline]
  );
  const [html, setHtml] = useState(base);

  useEffect(() => {
    setHtml(base);
    if (inline) return;
    let cancelled = false;
    highlightBlocks(base).then((enhanced) => {
      if (!cancelled && enhanced) setHtml(enhanced);
    });
    return () => {
      cancelled = true;
    };
  }, [base, inline]);

  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
