import type MarkdownIt from "markdown-it";

// Matches a comment reference like "#42". Only linkified when the id is a real
// comment in the review (passed via render env), so stray "#3" text stays plain.
const REF_RE = /#(\d+)/g;

// A markdown-it core rule that rewrites `#<id>` inside text into a link
// (<a class="comment-ref" data-comment-id=… href="#comment-…">). It runs on text
// tokens only, so `#42` inside inline code or a fenced block is left untouched.
// Gated on `env.commentIds` (a Set<number>) — absent env ⇒ no-op, which is how
// non-comment renders (markdown files, export preview) stay inert.
export function commentRefPlugin(md: MarkdownIt) {
  md.core.ruler.push("comment_ref", (state) => {
    const ids = state.env?.commentIds as Set<number> | undefined;
    if (!ids || ids.size === 0) return;
    for (const block of state.tokens) {
      if (block.type !== "inline" || !block.children) continue;
      const out: typeof block.children = [];
      let linkDepth = 0;
      for (const tok of block.children) {
        if (tok.type === "link_open") linkDepth++;
        else if (tok.type === "link_close") linkDepth--;
        // Skip non-text tokens, and any text already inside a link: linkifying `#42`
        // there would nest <a> inside <a> (invalid HTML). This also leaves a
        // linkified URL whose text contains "#<digits>" (e.g. .../pr#42) intact.
        if (tok.type !== "text" || linkDepth > 0) {
          out.push(tok);
          continue;
        }
        const mkText = (content: string) => {
          const t = new state.Token("text", "", 0);
          t.content = content;
          return t;
        };
        const text = tok.content;
        const nodes: typeof block.children = [];
        REF_RE.lastIndex = 0;
        let last = 0;
        let m: RegExpExecArray | null;
        while ((m = REF_RE.exec(text)) !== null) {
          const id = m[1];
          if (!ids.has(Number(id))) continue;
          if (m.index > last) nodes.push(mkText(text.slice(last, m.index)));
          const open = new state.Token("link_open", "a", 1);
          open.attrSet("class", "comment-ref");
          open.attrSet("href", `#comment-${id}`);
          open.attrSet("data-comment-id", id);
          nodes.push(open, mkText(`#${id}`), new state.Token("link_close", "a", -1));
          last = m.index + m[0].length;
        }
        if (nodes.length === 0) {
          out.push(tok);
          continue;
        }
        if (last < text.length) nodes.push(mkText(text.slice(last)));
        out.push(...nodes);
      }
      block.children = out;
    }
  });
}
