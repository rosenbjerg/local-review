import { useMemo } from "react";
import MarkdownIt from "markdown-it";

// Full renderer for comment/reply bodies. html:false makes the output safe to
// inject; breaks:true keeps the single newlines a reviewer typed.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

// Compact renderer for the comments-panel preview: inline formatting only. It
// lives inside a nav <button>, so links would be invalid nesting and hijack the
// jump click — link/image syntax collapses to its text instead.
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
