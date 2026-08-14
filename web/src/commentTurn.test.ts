import { describe, expect, it } from "vitest";
import { awaitingYouCount, turnOf } from "./commentTurn";
import type { Comment, Reply } from "./types";

const reply = (id: number, author: string): Reply => ({ id, author }) as Reply;

const comment = (id: number, over: Partial<Comment> = {}): Comment =>
  ({
    id,
    type: "suggestion",
    author: "reviewer",
    resolved: false,
    replies: [],
    ...over,
  }) as Comment;

describe("turnOf", () => {
  it("waits on you for an agent thread nobody has answered", () => {
    expect(turnOf(comment(1, { author: "review-agent" }))).toBe("you");
    expect(turnOf(comment(2, { author: "agent" }))).toBe("you");
  });

  it("waits on them for your own thread nobody has answered", () => {
    expect(turnOf(comment(1, { author: "reviewer" }))).toBe("them");
  });

  it("follows the newest reply, not the root", () => {
    const asked = comment(1, { author: "review-agent", replies: [reply(1, "reviewer")] });
    expect(turnOf(asked)).toBe("them");

    const answered = comment(2, { author: "reviewer", replies: [reply(1, "agent")] });
    expect(turnOf(answered)).toBe("you");
  });

  it("comes back to you when the agent replies to your reply", () => {
    const c = comment(1, {
      author: "review-agent",
      replies: [reply(1, "reviewer"), reply(2, "agent")],
    });
    expect(turnOf(c)).toBe("you");
  });

  it("takes the last reply by id, not by array position", () => {
    const c = comment(1, { author: "agent", replies: [reply(9, "reviewer"), reply(2, "agent")] });
    expect(turnOf(c)).toBe("them");
  });

  it("waits on nobody once resolved, whoever spoke last", () => {
    expect(turnOf(comment(1, { author: "review-agent", resolved: true }))).toBe("none");
    expect(turnOf(comment(2, { author: "reviewer", resolved: true }))).toBe("none");
  });

  it("still waits on you when the anchor went outdated", () => {
    expect(turnOf(comment(1, { author: "review-agent", anchorStatus: "outdated" }))).toBe("you");
  });

  it("reads a blank author as the reviewer's, like a pre-column row", () => {
    expect(turnOf(comment(1, { author: "" }))).toBe("them");
    expect(turnOf(comment(2, { author: "agent", replies: [reply(1, "")] }))).toBe("them");
  });

  it("tolerates a thread with no replies array", () => {
    expect(turnOf({ id: 1, author: "agent" } as Comment)).toBe("you");
  });
});

describe("awaitingYouCount", () => {
  it("counts only the threads whose move is yours", () => {
    const comments = [
      comment(1, { author: "review-agent" }),
      comment(2, { author: "reviewer" }),
      comment(3, { author: "review-agent", resolved: true }),
      comment(4, { author: "reviewer", replies: [reply(1, "agent")] }),
    ];
    expect(awaitingYouCount(comments)).toBe(2);
  });

  it("is zero for an empty review", () => {
    expect(awaitingYouCount([])).toBe(0);
  });
});
