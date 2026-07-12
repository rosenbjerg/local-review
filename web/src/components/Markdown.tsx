import { useMemo } from "react";
import MarkdownIt from "markdown-it";

// html:false — bodies are injected via dangerouslySetInnerHTML, so raw HTML must
// stay escaped.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

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
}: {
  source: string;
  className?: string;
  inline?: boolean;
}) {
  const html = useMemo(
    () => (inline ? inlineMd.renderInline(source) : md.render(source)),
    [source, inline]
  );
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
