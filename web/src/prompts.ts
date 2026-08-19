export type PromptKind = "reply" | "review";

// The review-specific values a prompt needs to name.
export interface PromptVars {
  origin: string;
  reviewId: number;
  headRef: string;
  baseRef: string;
}

// Copyable agent prompts shown in AgentPromptsModal: the two ways to hand a coding
// agent a review over the API. The canonical markdown export lives on the server
// (internal/export) — nothing here generates review content.
//
// They are *templates*, not finished strings. A reviewer can edit one and save it per
// repo (`readPromptOverride` in storage.ts), where it outlives the review it was
// edited against — so the volatile values stay as `{{placeholders}}` that
// `renderPrompt` fills in at copy time. Baking them in at edit time would save a
// prompt naming one review's id and refs and silently mis-brief the next agent.

const REPLY_TEMPLATE = `This is a code review produced with local-review. Fetch it from the API and work through every open comment.

For each comment: if you agree, make the change and reply noting what you did; if you disagree or need clarification, reply explaining why or asking a question. Comment types signal intent — bug and suggestion want a fix (or a reason it's declined), question wants an answer, nit is optional. A comment marked (outdated) or (moved from …) means the code shifted since it was written — trust the quoted snippet over the line number.

# Fetch the review as markdown. The response is JSON; read its "markdown" field.
# Each comment is headed with an id like "#42".
curl -s -X POST {{origin}}/api/reviews/{{reviewId}}/export | jq -r .markdown

# Reply to a comment by its id (the #42 in each heading; different per comment).
curl -s -X POST {{origin}}/api/comments/<id>/replies \\
  -H 'Content-Type: application/json' \\
  -d '{"body": "your reply here"}'
`;

const REVIEW_TEMPLATE = `Adversarially review the changes branch \`{{headRef}}\` introduces over \`{{baseRef}}\` in this repo, then file your findings as comments via the local-review API so the human reviewer sees them next to their own.

See exactly what changed:
git diff {{baseRef}}...{{headRef}}

Hunt for real defects — bugs, broken edge cases, race conditions, security holes, missing error handling, violated invariants. Read the surrounding code, not just the diff, to judge correctness. Favour a few high-confidence findings over noise.

# File a comment. Anchor it to the NEW side: the file's post-change path and its
# new-side line range (the server captures the code snippet from that range, so
# you don't send it). type is one of: bug | suggestion | question | nit. Tag every
# write with "author": "review-agent" so your findings stay distinct from the
# coding agent that will address them.
curl -s -X POST {{origin}}/api/reviews/{{reviewId}}/comments \\
  -H 'Content-Type: application/json' \\
  -d '{"filePath": "path/to/file", "startLine": 42, "endLine": 45, "type": "bug", "body": "what is wrong and why", "author": "review-agent"}'

# Re-read only the threads you started, with any reviewer replies nested under
# each comment's "replies" (JSON). Poll this to continue the conversation.
curl -s '{{origin}}/api/reviews/{{reviewId}}/comments?author=review-agent'

# Reply to a thread (use the comment's "id" from the JSON above).
curl -s -X POST {{origin}}/api/comments/<id>/replies \\
  -H 'Content-Type: application/json' \\
  -d '{"body": "your reply here", "author": "review-agent"}'

# Resolve a thread once it's addressed or you're satisfied it's a non-issue.
curl -s -X POST {{origin}}/api/comments/<id>/resolved \\
  -H 'Content-Type: application/json' \\
  -d '{"resolved": true}'
`;

export const AGENT_PROMPTS: { kind: PromptKind; label: string; template: string }[] = [
  { kind: "reply", label: "Address the review", template: REPLY_TEMPLATE },
  { kind: "review", label: "Do a review", template: REVIEW_TEMPLATE },
];

// The placeholder names `renderPrompt` substitutes — the keys of the map it builds,
// pinned by prompts.test.ts. Shown in the editor, since a saved template may rely on
// them and nothing else on screen says which names resolve.
export const PROMPT_PLACEHOLDERS = ["origin", "reviewId", "headRef", "baseRef"] as const;

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
  };
  return template.replace(/\{\{(\w+)\}\}/g, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : token
  );
}
