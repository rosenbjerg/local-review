import { useMemo } from "react";
import MarkdownIt from "markdown-it";

// Full renderer for comment & reply bodies (block + inline).
// html:false escapes any raw HTML, so the output is safe to inject; linkify
// auto-links bare URLs; breaks:true turns single newlines into <br> so the
// rendered text keeps the line breaks a reviewer typed in the textarea.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

// Compact renderer for the comments-panel preview: inline formatting only
// (bold/italic/code/strikethrough), no block elements and no line breaks. The
// preview lives inside a nav <button>, so anchors would be invalid nesting and
// would hijack the jump-to-comment click — link/image syntax collapses to its
// text instead. linkify is off so bare URLs stay plain in the tight preview.
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
