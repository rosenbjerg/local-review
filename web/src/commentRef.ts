import type MarkdownIt from "markdown-it";

const REF_RE = /#(\d+)/g;

// Core rule linking `#<id>` in text tokens only, so inline code and fences stay plain. Gated on
// `env.commentIds`: an unknown id, or a render without env (markdown files, export preview), stays inert.
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
        // Text already inside a link is skipped: nested <a> is invalid, and a linkified .../pr#42 must stay intact.
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
