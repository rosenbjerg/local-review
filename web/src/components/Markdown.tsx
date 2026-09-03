import { useEffect, useMemo, useState } from "react";
import MarkdownIt from "markdown-it";
import { highlightBlocks } from "../highlight";
import { renderMermaid } from "../mermaid";
import { commentRefPlugin } from "../commentRef";
import { useTheme } from "../theme";

// html:false — bodies are injected via dangerouslySetInnerHTML, so raw HTML must
// stay escaped. `md` renders comment bodies (soft newlines → <br>, GFM-style);
// `docMd` renders whole documents (export preview, markdown files) the standard
// CommonMark way, where a soft newline is just a space. Both linkify `#<id>`
// comment references when a `commentIds` set is passed as the render env.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true }).use(commentRefPlugin);
const docMd = new MarkdownIt({ html: false, linkify: true, breaks: false }).use(commentRefPlugin);

// This preview renders inside a nav <button>: links would be invalid nesting and
// hijack the jump click, so link/image syntax collapses to plain text.
const inlineMd = new MarkdownIt({ html: false, linkify: false, breaks: false });
inlineMd.renderer.rules.link_open = () => "";
inlineMd.renderer.rules.link_close = () => "";
inlineMd.renderer.rules.image = (tokens, idx) => inlineMd.utils.escapeHtml(tokens[idx].content);

export function Markdown({
  source,
  className,
  inline = false,
  softBreaks = true,
  commentIds,
}: {
  source: string;
  className?: string;
  inline?: boolean;
  softBreaks?: boolean;
  // When set, `#<id>` references to these comment ids become clickable links.
  commentIds?: Set<number>;
}) {
  const base = useMemo(
    () =>
      inline
        ? inlineMd.renderInline(source)
        : (softBreaks ? md : docMd).render(source, commentIds ? { commentIds } : {}),
    [source, inline, softBreaks, commentIds]
  );
  const [html, setHtml] = useState(base);
  // Both passes bake the theme's colors into the HTML, so a switch re-runs them.
  const theme = useTheme();

  useEffect(() => {
    setHtml(base);
    if (inline) return;
    let cancelled = false;
    highlightBlocks(base, theme).then(async (enhanced) => {
      if (cancelled) return;
      if (enhanced) setHtml(enhanced);
      const drawn = await renderMermaid(enhanced ?? base, theme);
      if (!cancelled && drawn) setHtml(drawn);
    });
    return () => {
      cancelled = true;
    };
  }, [base, inline, theme]);

  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
