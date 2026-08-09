import { describe, expect, it } from "vitest";
import type { Comment } from "./types";
import { ANY, NO_FILTER, authorsOf, filterComments, isFiltered } from "./commentFilter";

const comment = (id: number, over: Partial<Comment> = {}): Comment =>
  ({
    id,
    type: "suggestion",
    author: "reviewer",
    resolved: false,
    replies: [],
    ...over,
  }) as Comment;

const ids = (cs: Comment[]) => cs.map((c) => c.id);

describe("filterComments", () => {
  const comments = [
    comment(1, { author: "reviewer", type: "bug" }),
    comment(2, { author: "review-agent", type: "nit", resolved: true }),
    comment(3, { author: "review-agent", type: "bug", anchorStatus: "outdated" }),
    comment(4, { author: "agent", type: "question" }),
  ];

  it("keeps the list itself when nothing is narrowed", () => {
    expect(filterComments(comments, NO_FILTER)).toBe(comments);
  });

  it("narrows by status", () => {
    expect(ids(filterComments(comments, { ...NO_FILTER, status: "open" }))).toEqual([1, 3, 4]);
    expect(ids(filterComments(comments, { ...NO_FILTER, status: "resolved" }))).toEqual([2]);
    expect(ids(filterComments(comments, { ...NO_FILTER, status: "outdated" }))).toEqual([3]);
  });

  it("narrows by type", () => {
    expect(ids(filterComments(comments, { ...NO_FILTER, type: "bug" }))).toEqual([1, 3]);
  });

  it("narrows by the thread's author", () => {
    expect(ids(filterComments(comments, { ...NO_FILTER, author: "review-agent" }))).toEqual([2, 3]);
  });

  it("applies every axis at once", () => {
    expect(ids(filterComments(comments, { status: "open", type: "bug", author: "review-agent" }))).toEqual([3]);
  });

  it("yields nothing for an author no longer present", () => {
    expect(filterComments(comments, { ...NO_FILTER, author: "nobody" })).toEqual([]);
  });
});

describe("authorsOf", () => {
  it("lists the distinct thread authors, sorted", () => {
    const comments = [
      comment(1, { author: "reviewer" }),
      comment(2, { author: "review-agent" }),
      comment(3, { author: "reviewer" }),
      comment(4, { author: "agent" }),
    ];
    expect(authorsOf(comments)).toEqual(["agent", "review-agent", "reviewer"]);
  });

  it("skips a blank author rather than offering an unpickable choice", () => {
    expect(authorsOf([comment(1, { author: "" })])).toEqual([]);
  });
});

describe("isFiltered", () => {
  it("is false only when every axis is open", () => {
    expect(isFiltered(NO_FILTER)).toBe(false);
    expect(isFiltered({ status: "open", type: ANY, author: ANY })).toBe(true);
    expect(isFiltered({ status: ANY, type: "nit", author: ANY })).toBe(true);
    expect(isFiltered({ status: ANY, type: ANY, author: "agent" })).toBe(true);
  });
});
