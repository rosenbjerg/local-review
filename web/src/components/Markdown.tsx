import { useMemo } from "react";
import MarkdownIt from "markdown-it";

// Shared renderer for user-authored content (comment & reply bodies).
// html:false escapes any raw HTML, so the output is safe to inject; linkify
// auto-links bare URLs; breaks:true turns single newlines into <br> so the
// rendered text keeps the line breaks a reviewer typed in the textarea.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

export function Markdown({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => md.render(source), [source]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
