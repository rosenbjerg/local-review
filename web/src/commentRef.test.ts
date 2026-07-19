import { expect, test } from "vitest";
import MarkdownIt from "markdown-it";
import { commentRefPlugin } from "./commentRef";

const md = new MarkdownIt({ html: false, linkify: true, breaks: true }).use(commentRefPlugin);
const ids = new Set([42, 43]);
const render = (src: string, env: object = { commentIds: ids }) =>
  md.render(src, env as Record<string, unknown>);
const refs = (html: string) => html.split("comment-ref").length - 1;

test("a valid #id becomes a comment-ref link", () => {
  const out = render("see #42 for details");
  expect(out).toContain('class="comment-ref"');
  expect(out).toContain('href="#comment-42"');
  expect(out).toContain('data-comment-id="42"');
  expect(out).toContain(">#42</a>");
});

test("an id that isn't a real comment stays plain text", () => {
  const out = render("issue #99 here");
  expect(refs(out)).toBe(0);
  expect(out).toContain("#99");
});

test("no commentIds env → no linkification (markdown files / export preview)", () => {
  expect(refs(render("plain #42", {}))).toBe(0);
});

test("refs inside inline code and fenced blocks are left alone", () => {
  expect(refs(render("code `#42` stays"))).toBe(0);
  expect(render("code `#42` stays")).toContain("<code>#42</code>");
  expect(refs(render("```\n#42\n```"))).toBe(0);
});

test("multiple refs each linkify; unknown ones stay plain", () => {
  expect(refs(render("both #42 and #43"))).toBe(2);
  const mixed = render("#7 is not a comment but #42 is");
  expect(refs(mixed)).toBe(1);
  expect(mixed).toContain("#7");
});

test("a real markdown heading is not mistaken for a ref", () => {
  const out = render("# 42 heading");
  expect(out).toContain("<h1>");
  expect(refs(out)).toBe(0);
});

test("a ref inside a link or a linkified URL does not nest anchors", () => {
  // inside an explicit markdown link → the link wins, #42 stays plain
  const a = render("see [the fix #42](https://x.com)");
  expect(refs(a)).toBe(0);
  expect(a).toContain(">the fix #42</a>");
  // inside a linkified URL fragment → untouched
  expect(refs(render("https://example.com/pr#42"))).toBe(0);
  // an explicit [#42](url) link is respected; a bare #42 after it still linkifies
  const d = render("[#42](https://x) and bare #42");
  expect(refs(d)).toBe(1);
  expect(d).toContain('href="https://x"');
});
