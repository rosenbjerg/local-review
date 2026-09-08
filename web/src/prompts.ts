export type PromptGroup = "reply" | "review";

export type PromptKind = "reply" | "review" | "review:security" | "review:design" | "review:tests";

// The review-specific values a prompt needs to name — everything App knows.
export interface ReviewVars {
  origin: string;
  reviewId: number;
  headRef: string;
  baseRef: string;
}

// The review's values plus the selected prompt's own `author`; the modal merges the two at copy time.
export interface PromptVars extends ReviewVars {
  author: string;
}

// The copyable agent prompts (AgentPromptsModal). They are templates saved per repo, so volatile values
// stay `{{placeholders}}` filled at copy time — baked in, a saved prompt would carry one review's id and refs.

const REPLY_TEMPLATE = `This is a code review produced with local-review. Fetch it from the API and work through every open comment.

For each comment: if you agree, make the change and reply noting what you did; if you disagree or need clarification, reply explaining why or asking a question. Comment types signal intent — bug and suggestion want a fix (or a reason it's declined), question wants an answer, nit is optional. The author on each comment says which lens produced it (correctness, security, design or tests), so weigh a suggestion accordingly. A comment marked (outdated) or (moved from …) means the code shifted since it was written — trust the quoted snippet over the line number.

# Fetch the review as markdown. Each comment is headed with an id like "#42".
curl -s -X POST {{origin}}/api/reviews/{{reviewId}}/export.md

# Reply to a comment by its id (the #42 in each heading; different per comment).
curl -s -X POST {{origin}}/api/comments/<id>/replies \\
  -H 'Content-Type: application/json' \\
  -d '{"body": "your reply here", "author": "{{author}}"}'
`;

// One focus per prompt, deliberately: the focuses differ in how the agent traverses the code, and one
// merged brief collapses that into a single cheap pass. Only the brief differs, so head and API block are shared.

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

// Shared by every focus, after the brief: what a finding may cost the reviewer to read.
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

// `kind` is the storage key, independent of `label` and `author` so renaming either can't orphan a saved template.
// Authors must stay distinct, or two focuses merge into one filter choice and one `?author=` poll.
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

// The modal's first row; listed rather than derived, since a one-prompt group needs no focus toggle.
export const PROMPT_GROUPS: { group: PromptGroup; label: string }[] = [
  { group: "reply", label: "Address the review" },
  { group: "review", label: "Do a review" },
];

// The placeholders `renderPrompt` substitutes; shown in the editor, since nothing else says which names resolve.
export const PROMPT_PLACEHOLDERS = ["origin", "reviewId", "headRef", "baseRef", "author"] as const;

// An unrecognised token is left standing rather than blanked (a `{{orgin}}` typo shows what went wrong);
// the lookup is own-property only, so `{{constructor}}` is an unknown token, not a prototype function.
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
