import type { Review } from "./types";

// Copyable agent prompts shown in AgentPromptsModal. Pure string builders — the
// canonical markdown export lives on the server (internal/export); these are the
// two ways to hand a coding agent a review over the API.

export function buildReplyPrompt(review: Review, origin: string): string {
  return `This is a code review produced with local-review. Fetch it from the API and work through every open comment.

For each comment: if you agree, make the change and reply noting what you did; if you disagree or need clarification, reply explaining why or asking a question. Comment types signal intent — bug and suggestion want a fix (or a reason it's declined), question wants an answer, nit is optional. A comment marked (outdated) or (moved from …) means the code shifted since it was written — trust the quoted snippet over the line number.

# Fetch the review as markdown. The response is JSON; read its "markdown" field.
# Each comment is headed with an id like "#42".
curl -s -X POST ${origin}/api/reviews/${review.id}/export | jq -r .markdown

# Reply to a comment by its id (the #42 in each heading; different per comment).
curl -s -X POST ${origin}/api/comments/<id>/replies \\
  -H 'Content-Type: application/json' \\
  -d '{"body": "your reply here"}'
`;
}

export function buildReviewPrompt(review: Review, origin: string): string {
  return `Adversarially review the changes branch \`${review.headRef}\` introduces over \`${review.baseRef}\` in this repo, then file your findings as comments via the local-review API so the human reviewer sees them next to their own.

See exactly what changed:
git diff ${review.baseRef}...${review.headRef}

Hunt for real defects — bugs, broken edge cases, race conditions, security holes, missing error handling, violated invariants. Read the surrounding code, not just the diff, to judge correctness. Favour a few high-confidence findings over noise.

# File a comment. Anchor it to the NEW side: the file's post-change path and its
# new-side line range (the server captures the code snippet from that range, so
# you don't send it). type is one of: bug | suggestion | question | nit. Tag every
# write with "author": "review-agent" so your findings stay distinct from the
# coding agent that will address them.
curl -s -X POST ${origin}/api/reviews/${review.id}/comments \\
  -H 'Content-Type: application/json' \\
  -d '{"filePath": "path/to/file", "startLine": 42, "endLine": 45, "type": "bug", "body": "what is wrong and why", "author": "review-agent"}'

# Re-read only the threads you started, with any reviewer replies nested under
# each comment's "replies" (JSON). Poll this to continue the conversation.
curl -s '${origin}/api/reviews/${review.id}/comments?author=review-agent'

# Reply to a thread (use the comment's "id" from the JSON above).
curl -s -X POST ${origin}/api/comments/<id>/replies \\
  -H 'Content-Type: application/json' \\
  -d '{"body": "your reply here", "author": "review-agent"}'

# Resolve a thread once it's addressed or you're satisfied it's a non-issue.
curl -s -X POST ${origin}/api/comments/<id>/resolved \\
  -H 'Content-Type: application/json' \\
  -d '{"resolved": true}'
`;
}
