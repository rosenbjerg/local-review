import { expect, test } from "vitest";

// A saved prompt outlives the review it was edited against, so the review-specific
// values live in the template as placeholders. These pin the substitution rules and,
// more importantly, that the shipped templates only use names that resolve.
import { AGENT_PROMPTS, PROMPT_PLACEHOLDERS, renderPrompt } from "./prompts";

const vars = {
  origin: "http://127.0.0.1:7777",
  reviewId: 7,
  headRef: "feat/x",
  baseRef: "main",
};

test("every placeholder substitutes, at every occurrence", () => {
  expect(renderPrompt("{{origin}}/api/reviews/{{reviewId}} {{reviewId}}", vars)).toBe(
    "http://127.0.0.1:7777/api/reviews/7 7"
  );
  expect(renderPrompt("`{{headRef}}` over `{{baseRef}}`", vars)).toBe("`feat/x` over `main`");
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
    const rendered = renderPrompt(p.template, vars);
    expect(rendered, `${p.kind} template`).not.toMatch(/\{\{/);
    // And they do carry the review's identity — an id-free prompt would send an agent
    // to guess which review to fetch.
    expect(rendered, `${p.kind} template`).toContain("http://127.0.0.1:7777/api/");
  }
});
