export type PromptGroup = "reply" | "review";

export type PromptKind = "reply" | "review" | "review:security" | "review:design" | "review:tests";

// The review-specific values a prompt needs to name — everything App knows.
export interface ReviewVars {
  origin: string;
  reviewId: number;
  headRef: string;
  baseRef: string;
}

// Everything a prompt interpolates: the review's values plus the selected prompt's
// own `author`, which is a property of the prompt kind rather than of the review
// (see AGENT_PROMPTS). The modal merges the two at copy time.
export interface PromptVars extends ReviewVars {
  author: string;
}

// Copyable agent prompts shown in AgentPromptsModal: the ways to hand a coding agent
// a review over the API — one to address a review, and one per review *focus* to
// produce findings. The canonical markdown export lives on the server
// (internal/export) — nothing here generates review content.
//
// They are *templates*, not finished strings. A reviewer can edit one and save it per
// repo (`readPromptOverride` in storage.ts), where it outlives the review it was
// edited against — so the volatile values stay as `{{placeholders}}` that
// `renderPrompt` fills in at copy time. Baking them in at edit time would save a
// prompt naming one review's id and refs and silently mis-brief the next agent.

const REPLY_TEMPLATE = `This is a code review produced with local-review. Fetch it from the API and work through every open comment.

For each comment: if you agree, make the change and reply noting what you did; if you disagree or need clarification, reply explaining why or asking a question. Comment types signal intent — bug and suggestion want a fix (or a reason it's declined), question wants an answer, nit is optional. The author on each comment says which lens produced it (correctness, security, design or tests), so weigh a suggestion accordingly. A comment marked (outdated) or (moved from …) means the code shifted since it was written — trust the quoted snippet over the line number.

# Fetch the review as markdown. Each comment is headed with an id like "#42".
curl -s -X POST {{origin}}/api/reviews/{{reviewId}}/export.md

# Reply to a comment by its id (the #42 in each heading; different per comment).
curl -s -X POST {{origin}}/api/comments/<id>/replies \\
  -H 'Content-Type: application/json' \\
  -d '{"body": "your reply here", "author": "{{author}}"}'
`;

// The review prompts are one focus each, deliberately: the focuses differ by how the
// agent *traverses* the code (security follows untrusted input inward, design reads
// well outside the diff, tests enumerate behaviours), and merging them into one brief
// collapses those into a single cheap pass over the diff. Run several by running the
// agent several times — they file into the same review under different authors.
//
// Only the brief differs, so the framing and the API block are shared here rather
// than copy-pasted per focus: a change to the API has one place to land. What a
// reviewer *saves* is still one complete self-contained template per focus.

const REVIEW_HEAD = `Review the changes branch \`{{headRef}}\` introduces over \`{{baseRef}}\` in this repo, through one specific lens, then file your findings as comments via the local-review API so the human reviewer sees them next to their own.

See exactly what changed:
git diff {{baseRef}}...{{headRef}}
`;

const REVIEW_API = `
# File a comment. Anchor it to the NEW side: the file's post-change path and its
# new-side line range (the server captures the code snippet from that range, so
# you don't send it). Use startLine 0 and endLine 0 for a finding about the file as
# a whole. type is one of: bug | suggestion | question | nit. Tag every write with
# "author": "{{author}}", so this pass's findings stay distinct from the other
# review passes and from the coding agent that will address them.
curl -s -X POST {{origin}}/api/reviews/{{reviewId}}/comments \\
  -H 'Content-Type: application/json' \\
  -d '{"filePath": "path/to/file", "startLine": 42, "endLine": 45, "type": "bug", "body": "what is wrong and why", "author": "{{author}}"}'

# Re-read only the threads you started, with any reviewer replies nested under
# each comment's "replies" (JSON). Poll this to continue the conversation.
curl -s '{{origin}}/api/reviews/{{reviewId}}/comments?author={{author}}'

# Reply to a thread (use the comment's "id" from the JSON above).
curl -s -X POST {{origin}}/api/comments/<id>/replies \\
  -H 'Content-Type: application/json' \\
  -d '{"body": "your reply here", "author": "{{author}}"}'

# Resolve a thread once it's addressed or you're satisfied it's a non-issue.
curl -s -X POST {{origin}}/api/comments/<id>/resolved \\
  -H 'Content-Type: application/json' \\
  -d '{"resolved": true}'
`;

// Shared by every focus, and placed after the brief: the lens says what to look for,
// this says what a finding may cost the reviewer to read.
const REVIEW_STYLE = `Keep every comment short — a few sentences, one short paragraph at most. State what is wrong and what to do about it, and stop. No preamble, no restating the code you are commenting on, no summary of the file: the reviewer reads these beside the diff, not instead of it. A long comment gets skimmed, which is how a real finding gets missed.
`;

function reviewTemplate(brief: string): string {
  return `${REVIEW_HEAD}\n${brief}\n\n${REVIEW_STYLE}${REVIEW_API}`;
}

const CORRECTNESS_BRIEF = `Your lens is correctness. Hunt for real defects: bugs, broken edge cases, race conditions, missing or wrong error handling, violated invariants, off-by-one and nil/undefined paths. Read the surrounding code and the callers, not just the diff — a changed line usually breaks something the diff doesn't show. Security and test coverage each have their own pass; stay on correctness here.

Favour a few high-confidence findings over noise. For each one, name the input or sequence of events that triggers it — a finding that can't name one is a guess, and it costs the reviewer more to check than it saves.`;

const SECURITY_BRIEF = `Your lens is security. Work from the outside in rather than reading the diff top to bottom: find where this change touches untrusted input — request handlers, CLI arguments, file paths, environment, anything crossing a process, network or trust boundary — and follow each value through the changed code to where it is used.

Look for injection (SQL, shell, HTML/JS, template), path traversal and symlink escapes, missing or wrong authorization checks, secrets reaching logs or error messages, unsafe deserialization, SSRF and unvalidated outbound requests, TOCTOU races, resource exhaustion from unbounded input, and sanitization that a later branch undoes.

Report only what is reachable. For each finding, name the entry point, the path the value takes to get there, and what an attacker gains. An issue with no reachable path is not a finding — drop it rather than hedging it.`;

const DESIGN_BRIEF = `Your lens is design: the shape of the change, not its correctness. Read well outside the diff. How does this codebase already solve this kind of problem, and does the change follow that or invent a parallel way of doing it? Read the repo's own guidance (CLAUDE.md, README, CONTRIBUTING) and judge the change against what it says.

Look for logic sitting in the wrong layer, state duplicated where one source of truth would do, an abstraction that leaks or that earns nothing, a special case that should be general (or a generalisation nobody asked for), names that mislead about what something does, and public surface that will be expensive to change later.

File few findings, and make each one actionable: say what you would do instead and what it buys. An objection with no alternative is not a finding. Most of these are about a file or a module rather than a line, so anchor them as file-level comments (startLine 0, endLine 0) unless one line really is the subject — a design objection pinned to an arbitrary line reads as a nit about that line. Prefer type "suggestion".`;

const TESTS_BRIEF = `Your lens is test coverage. Enumerate the behaviours this change introduces or alters, then find the test covering each one. The gaps are your findings.

Look for new behaviour with no test at all, error and edge paths where only the happy path is exercised, tests that assert on shape (it was called, it returned an object) rather than on behaviour, over-mocked tests that only exercise the mock, and existing tests this change should have updated but didn't. A useful check for a weak test: name a single line you could break in the code under it that would leave it passing.

Point at the specific untested behaviour, not at a file's coverage in general, and say what the missing test should assert. Use type "suggestion" for a missing test and "bug" only where an existing test is actively wrong about what it claims to verify.`;

// `kind` is the storage key (see storage.ts) and is deliberately independent of both
// `label` and `author`, so renaming either can't orphan a reviewer's saved template.
// Correctness keeps the original `review` key for that reason.
//
// Authors share a `-review-agent` suffix: it keeps the family recognisable in the
// comments pane's author filter and in the export headings, and makes "any review
// agent" expressible later without renaming anything. They must stay distinct — two
// focuses under one author would merge into a single filter choice and a single
// `?author=` poll.
export const AGENT_PROMPTS: {
  kind: PromptKind;
  group: PromptGroup;
  label: string;
  author: string;
  template: string;
}[] = [
  {
    kind: "reply",
    group: "reply",
    label: "Address the review",
    author: "agent",
    template: REPLY_TEMPLATE,
  },
  {
    kind: "review",
    group: "review",
    label: "Correctness",
    author: "correctness-review-agent",
    template: reviewTemplate(CORRECTNESS_BRIEF),
  },
  {
    kind: "review:security",
    group: "review",
    label: "Security",
    author: "security-review-agent",
    template: reviewTemplate(SECURITY_BRIEF),
  },
  {
    kind: "review:design",
    group: "review",
    label: "Design",
    author: "design-review-agent",
    template: reviewTemplate(DESIGN_BRIEF),
  },
  {
    kind: "review:tests",
    group: "review",
    label: "Tests",
    author: "test-review-agent",
    template: reviewTemplate(TESTS_BRIEF),
  },
];

// The modal's first row. The second row (which focus) only applies to `review`, so
// the groups are listed rather than derived — one prompt in a group needs no toggle.
export const PROMPT_GROUPS: { group: PromptGroup; label: string }[] = [
  { group: "reply", label: "Address the review" },
  { group: "review", label: "Do a review" },
];

// The placeholder names `renderPrompt` substitutes — the keys of the map it builds,
// pinned by prompts.test.ts. Shown in the editor, since a saved template may rely on
// them and nothing else on screen says which names resolve.
export const PROMPT_PLACEHOLDERS = ["origin", "reviewId", "headRef", "baseRef", "author"] as const;

// Fill in `{{token}}` for each of PROMPT_PLACEHOLDERS. Two rules, both about the text
// being hand-edited: an unrecognised token is left standing rather than blanked (a
// typo that reads back as `{{orgin}}` says what went wrong, where an empty gap would
// not), and the lookup is own-property only, so `{{constructor}}` is an unknown token
// and not a function off the prototype chain.
export function renderPrompt(template: string, vars: PromptVars): string {
  const values: Record<string, string> = {
    origin: vars.origin,
    reviewId: String(vars.reviewId),
    headRef: vars.headRef,
    baseRef: vars.baseRef,
    author: vars.author,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : token
  );
}
