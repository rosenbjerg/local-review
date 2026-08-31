import { describe, expect, it } from "vitest";
import type { Comment, Reply } from "./types";
import {
  ANY,
  NO_FILTER,
  authorsOf,
  filterComments,
  isFiltered,
  queryNeedle,
} from "./commentFilter";

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

  it("narrows by whose move it is, resolved counting as neither", () => {
    const threads = [
      comment(1, { author: "review-agent" }),
      comment(2, { author: "reviewer" }),
      comment(3, { author: "review-agent", resolved: true }),
      comment(4, { author: "review-agent", replies: [{ id: 1, author: "reviewer" } as Reply] }),
    ];
    expect(ids(filterComments(threads, { ...NO_FILTER, status: "awaiting-you" }))).toEqual([1]);
    expect(ids(filterComments(threads, { ...NO_FILTER, status: "awaiting-them" }))).toEqual([2, 4]);
  });

  it("narrows by type", () => {
    expect(ids(filterComments(comments, { ...NO_FILTER, type: "bug" }))).toEqual([1, 3]);
  });

  it("narrows by the thread's author", () => {
    expect(ids(filterComments(comments, { ...NO_FILTER, author: "review-agent" }))).toEqual([2, 3]);
  });

  it("applies every axis at once", () => {
    expect(
      ids(filterComments(comments, { status: "open", type: "bug", author: "review-agent", query: "" }))
    ).toEqual([3]);
  });

  it("narrows by a case-insensitive substring of the body", () => {
    const threads = [
      comment(1, { body: "The Auth check is inverted" }),
      comment(2, { body: "nit: spelling" }),
    ];
    expect(ids(filterComments(threads, { ...NO_FILTER, query: "auth" }))).toEqual([1]);
    expect(ids(filterComments(threads, { ...NO_FILTER, query: "AUTH" }))).toEqual([1]);
  });

  // The pane lists thread roots, so a term living only in a reply has to surface
  // the root that holds it — else "the agent said X" is unfindable.
  it("matches a reply's body too, surfacing its root", () => {
    const threads = [
      comment(1, { body: "why?", replies: [{ id: 1, body: "because of the mutex" } as Reply] }),
      comment(2, { body: "why?" }),
    ];
    expect(ids(filterComments(threads, { ...NO_FILTER, query: "mutex" }))).toEqual([1]);
  });

  // A rename-moved comment renders under its new path but was filed against the
  // old one, so both have to find it.
  it("matches either path of a rename-moved comment", () => {
    const moved = comment(1, {
      filePath: "old/name.go",
      anchorStatus: "moved",
      currentFilePath: "new/name.go",
      body: "",
    });
    expect(ids(filterComments([moved], { ...NO_FILTER, query: "old/name" }))).toEqual([1]);
    expect(ids(filterComments([moved], { ...NO_FILTER, query: "new/name" }))).toEqual([1]);
  });

  it("treats a whitespace-only query as no query at all", () => {
    const threads = [comment(1, { body: "a" }), comment(2, { body: "b" })];
    expect(filterComments(threads, { ...NO_FILTER, query: "  " })).toBe(threads);
    expect(queryNeedle("  Auth  ")).toBe("auth");
  });

  it("combines the query with the other axes", () => {
    const threads = [
      comment(1, { type: "bug", body: "auth is wrong" }),
      comment(2, { type: "nit", body: "auth is wrong" }),
    ];
    expect(ids(filterComments(threads, { ...NO_FILTER, type: "bug", query: "auth" }))).toEqual([1]);
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
    expect(isFiltered({ status: "open", type: ANY, author: ANY, query: "" })).toBe(true);
    expect(isFiltered({ status: ANY, type: "nit", author: ANY, query: "" })).toBe(true);
    expect(isFiltered({ status: ANY, type: ANY, author: "agent", query: "" })).toBe(true);
    expect(isFiltered({ ...NO_FILTER, query: "auth" })).toBe(true);
  });
});
