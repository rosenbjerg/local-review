import { expect, test } from "vitest";

// A saved prompt outlives the review it was edited against, so the review-specific
// values live in the template as placeholders. These pin the substitution rules and,
// more importantly, that the shipped templates only use names that resolve.
import { AGENT_PROMPTS, PROMPT_GROUPS, PROMPT_PLACEHOLDERS, renderPrompt } from "./prompts";

const vars = {
  origin: "http://127.0.0.1:7777",
  reviewId: 7,
  headRef: "feat/x",
  baseRef: "main",
  author: "correctness-review-agent",
};

test("every placeholder substitutes, at every occurrence", () => {
  expect(renderPrompt("{{origin}}/api/reviews/{{reviewId}} {{reviewId}}", vars)).toBe(
    "http://127.0.0.1:7777/api/reviews/7 7"
  );
  expect(renderPrompt("`{{headRef}}` over `{{baseRef}}`", vars)).toBe("`feat/x` over `main`");
  expect(renderPrompt("?author={{author}}", vars)).toBe("?author=correctness-review-agent");
});

test("an unknown token is left standing rather than blanked", () => {
  // The template is hand-edited text: a typo that reads back says what went wrong,
  // where an empty gap in a curl command would not.
  expect(renderPrompt("{{orgin}}/api", vars)).toBe("{{orgin}}/api");
  // Own-property lookup only — otherwise these resolve off the prototype chain.
  expect(renderPrompt("{{constructor}} {{toString}}", vars)).toBe("{{constructor}} {{toString}}");
});

test("PROMPT_PLACEHOLDERS lists exactly the names that resolve", () => {
  // The list is what the editor shows; a name on it that doesn't substitute (or one
  // missing from it) would send a reviewer to write a token that stays literal.
  for (const name of PROMPT_PLACEHOLDERS) {
    expect(renderPrompt(`{{${name}}}`, vars)).not.toBe(`{{${name}}}`);
  }
});

test("the shipped templates leave no placeholder behind", () => {
  for (const p of AGENT_PROMPTS) {
    const rendered = renderPrompt(p.template, { ...vars, author: p.author });
    expect(rendered, `${p.kind} template`).not.toMatch(/\{\{/);
    // And they do carry the review's identity — an id-free prompt would send an agent
    // to guess which review to fetch.
    expect(rendered, `${p.kind} template`).toContain("http://127.0.0.1:7777/api/");
  }
});

test("every place a prompt names an author names the same one", () => {
  // The author appears in the POST body, the ?author= poll and the reply body. It's a
  // placeholder rather than a literal precisely so those can't drift apart: an agent
  // filing under one name and polling another would see none of its own threads, and
  // the drift would be invisible until it silently reported nothing to answer.
  for (const p of AGENT_PROMPTS) {
    const rendered = renderPrompt(p.template, { ...vars, author: p.author });
    const named = [
      ...[...rendered.matchAll(/"author": "([^"]+)"/g)].map((m) => m[1]),
      ...[...rendered.matchAll(/[?&]author=([\w-]+)/g)].map((m) => m[1]),
    ];
    for (const name of named) expect(name, `${p.kind} template`).toBe(p.author);
    // Only the review prompts have to name one. The reply prompt leaves the author to the API's
    // "agent" default — which is its own author — so it writes none, and the placeholder is there
    // for a reviewer who edits a `"author"` field back in.
    if (p.group === "review") {
      expect(named.length, `${p.kind} template names no author`).toBeGreaterThan(0);
    }
  }
});

test("the reply prompt sends the agent to the export's instructions instead of restating them", () => {
  // `internal/export` is the only author of the agent contract (CONTRIBUTING). A copy here would be
  // a second one, in another language, that the next wording change leaves behind.
  const reply = AGENT_PROMPTS.filter((p) => p.group === "reply");
  expect(reply.length).toBeGreaterThan(0);
  for (const p of reply) {
    expect(p.template, `${p.kind} template`).toContain("export.md?instructions=true");
    expect(p.template, `${p.kind} template restates the reply endpoint`).not.toContain("/replies");
  }
});

test("authors are distinct, and the review ones share the -review-agent suffix", () => {
  // Two focuses under one author would merge into a single filter choice in the
  // comments pane and a single ?author= poll — the whole point is that they don't.
  const authors = AGENT_PROMPTS.map((p) => p.author);
  expect(new Set(authors).size).toBe(authors.length);
  // The suffix is what makes the family recognisable in the pane and the export, and
  // what a future "any review agent" filter would match on.
  for (const p of AGENT_PROMPTS) {
    expect(p.author.endsWith("-review-agent"), `${p.kind} author`).toBe(p.group === "review");
  }
});

test("every review focus carries the shared API block and its own brief", () => {
  const reviews = AGENT_PROMPTS.filter((p) => p.group === "review");
  expect(reviews.length).toBeGreaterThan(1);
  for (const p of reviews) {
    // Composed from one place, so a change to the API lands in every focus at once.
    expect(p.template, `${p.kind} template`).toContain("/comments?author=");
    expect(p.template, `${p.kind} template`).toContain("git diff {{baseRef}}...{{headRef}}");
    // One lens per prompt: the brief has to say which.
    expect(p.template, `${p.kind} template`).toContain("Your lens is");
  }
});

test("every prompt belongs to a listed group, and every group has a prompt", () => {
  // The modal's first row is PROMPT_GROUPS and its second row filters AGENT_PROMPTS
  // by group, so a prompt in an unlisted group would be unreachable on screen.
  const groups = new Set(PROMPT_GROUPS.map((g) => g.group));
  for (const p of AGENT_PROMPTS) expect(groups.has(p.group), `${p.kind} group`).toBe(true);
  for (const g of groups) expect(AGENT_PROMPTS.some((p) => p.group === g), g).toBe(true);
});
