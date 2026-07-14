import { useEffect, useMemo, useState } from "react";
import MarkdownIt from "markdown-it";
import { highlightBlocks } from "../highlight";

// html:false — bodies are injected via dangerouslySetInnerHTML, so raw HTML must
// stay escaped. `md` renders comment bodies (soft newlines → <br>, GFM-style);
// `docMd` renders whole documents (export preview, markdown files) the standard
// CommonMark way, where a soft newline is just a space.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
const docMd = new MarkdownIt({ html: false, linkify: true, breaks: false });

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
}: {
  source: string;
  className?: string;
  inline?: boolean;
  softBreaks?: boolean;
}) {
  const base = useMemo(
    () => (inline ? inlineMd.renderInline(source) : (softBreaks ? md : docMd).render(source)),
    [source, inline, softBreaks]
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
