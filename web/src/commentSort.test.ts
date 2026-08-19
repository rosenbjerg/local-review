import { describe, expect, it } from "vitest";
import { COMMENT_SORTS, isCommentSort, lastActivityAt, sortComments } from "./commentSort";
import type { Comment, Reply } from "./types";

const reply = (id: number, over: Partial<Reply> = {}): Reply =>
  ({ id, author: "agent", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over }) as Reply;

// Timestamps default to one shared value so a case that doesn't care about time
// exercises the tie-break rather than accidentally ordering by it.
const comment = (id: number, over: Partial<Comment> = {}): Comment =>
  ({
    id,
    filePath: "a.ts",
    startLine: 1,
    endLine: 1,
    type: "suggestion",
    author: "reviewer",
    resolved: false,
    replies: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  }) as Comment;

const ids = (cs: Comment[]) => cs.map((c) => c.id);

describe("isCommentSort", () => {
  it("accepts every declared sort and nothing else", () => {
    for (const s of COMMENT_SORTS) expect(isCommentSort(s.value)).toBe(true);
    for (const bad of ["", "line", "File order", "activity "]) {
      expect(isCommentSort(bad)).toBe(false);
    }
  });
});

describe("lastActivityAt", () => {
  it("takes the newest of the comment's own stamps and every reply's", () => {
    const c = comment(1, {
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      replies: [
        reply(1, { createdAt: "2026-01-03T00:00:00Z", updatedAt: "2026-01-03T00:00:00Z" }),
        reply(2, { createdAt: "2026-01-04T00:00:00Z", updatedAt: "2026-01-05T00:00:00Z" }),
      ],
    });
    expect(lastActivityAt(c)).toBe("2026-01-05T00:00:00Z");
  });

  it("falls back to createdAt when nothing is newer", () => {
    expect(lastActivityAt(comment(1, { createdAt: "2026-02-01T00:00:00Z", updatedAt: "" }))).toBe(
      "2026-02-01T00:00:00Z"
    );
  });
});

describe("sortComments", () => {
  const order = ["src/a.ts", "src/b.ts", "z/last.ts"];

  it("orders by file-tree position then line, not by path name", () => {
    // The file order is the explorer's, so "z/last.ts" sitting last is a property of
    // the given order and not of alphabetics — a.ts/b.ts would sort the same either way.
    const out = sortComments(
      [
        comment(1, { filePath: "z/last.ts", startLine: 5 }),
        comment(2, { filePath: "src/b.ts", startLine: 20 }),
        comment(3, { filePath: "src/a.ts", startLine: 99 }),
        comment(4, { filePath: "src/a.ts", startLine: 2 }),
      ],
      "file",
      order
    );
    expect(ids(out)).toEqual([4, 3, 2, 1]);
  });

  it("anchors a moved comment under its current line and path", () => {
    const moved = comment(1, {
      filePath: "z/last.ts",
      startLine: 90,
      anchorStatus: "moved",
      currentFilePath: "src/a.ts",
      currentStartLine: 3,
      currentEndLine: 3,
    });
    const out = sortComments([comment(2, { filePath: "src/a.ts", startLine: 10 }), moved], "file", order);
    expect(ids(out)).toEqual([1, 2]);
  });

  it("groups by file in the time sorts too, not just in file order", () => {
    const out = sortComments(
      [
        comment(1, { filePath: "src/a.ts", createdAt: "2026-01-01T00:00:00Z" }),
        comment(2, { filePath: "src/b.ts", createdAt: "2026-01-02T00:00:00Z" }),
        comment(3, { filePath: "src/a.ts", createdAt: "2026-01-03T00:00:00Z" }),
      ],
      "started",
      order
    );
    // a.ts is hoisted to its first comment's slot and keeps both of its own.
    expect(ids(out)).toEqual([1, 3, 2]);
  });

  it("puts a file where its first-listed comment would sit in a flat sort", () => {
    const out = sortComments(
      [
        comment(1, { filePath: "src/b.ts", createdAt: "2026-01-01T00:00:00Z" }),
        comment(2, { filePath: "src/a.ts", createdAt: "2026-01-02T00:00:00Z" }),
        comment(3, { filePath: "src/b.ts", createdAt: "2026-01-03T00:00:00Z" }),
      ],
      "started",
      order
    );
    // b.ts owns the oldest comment, so it leads — despite sitting later in the tree.
    expect(ids(out)).toEqual([1, 3, 2]);
  });

  it("sinks a resolved thread within its file without moving the file", () => {
    const out = sortComments(
      [
        comment(1, { filePath: "src/a.ts", startLine: 1, resolved: true }),
        comment(2, { filePath: "src/a.ts", startLine: 50 }),
        comment(3, { filePath: "src/b.ts", startLine: 1 }),
      ],
      "file",
      order
    );
    // The resolved one sinks past line 50 but stays inside a.ts, which keeps its slot.
    expect(ids(out)).toEqual([2, 1, 3]);
  });

  it("keeps an all-resolved file in its natural slot", () => {
    const out = sortComments(
      [
        comment(1, { filePath: "src/b.ts", startLine: 1 }),
        comment(2, { filePath: "src/a.ts", startLine: 1, resolved: true }),
      ],
      "file",
      order
    );
    expect(ids(out)).toEqual([2, 1]);
  });

  // The group key is read *after* the within-file sort, so a resolved thread that
  // was bumped to the top by recent activity can't hoist its file while sitting at
  // the bottom of it. Reading the key first would put b.ts ahead of a.ts here.
  it("does not let a bumped resolved thread hoist its file", () => {
    const out = sortComments(
      [
        comment(1, {
          filePath: "src/b.ts",
          resolved: true,
          createdAt: "2026-01-09T00:00:00Z",
          updatedAt: "2026-01-09T00:00:00Z",
        }),
        comment(2, { filePath: "src/b.ts", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }),
        comment(3, { filePath: "src/a.ts", createdAt: "2026-01-05T00:00:00Z", updatedAt: "2026-01-05T00:00:00Z" }),
      ],
      "activity",
      order
    );
    // b.ts is keyed on comment 2 (its first *listed*, since 1 sank), so a.ts leads.
    expect(ids(out)).toEqual([3, 2, 1]);
  });

  it("orders activity newest-first, counting replies", () => {
    const out = sortComments(
      [
        comment(1, {
          filePath: "src/a.ts",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          replies: [reply(9, { createdAt: "2026-01-08T00:00:00Z", updatedAt: "2026-01-08T00:00:00Z" })],
        }),
        comment(2, { filePath: "src/a.ts", createdAt: "2026-01-04T00:00:00Z", updatedAt: "2026-01-04T00:00:00Z" }),
      ],
      "activity",
      order
    );
    // 1 is older but its reply is the newest thing in the review.
    expect(ids(out)).toEqual([1, 2]);
  });

  // Resolving deliberately doesn't bump updated_at (see store.SetCommentResolved),
  // so it must not reorder the activity sort either.
  it("does not treat resolving as activity", () => {
    const base = [
      comment(1, { filePath: "src/a.ts", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }),
      comment(2, { filePath: "src/a.ts", createdAt: "2026-01-02T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" }),
    ];
    expect(ids(sortComments(base, "activity", order))).toEqual([2, 1]);
    // Resolving the newer one sinks it within the file, and changes nothing else.
    const resolved = [base[0], { ...base[1], resolved: true }];
    expect(ids(sortComments(resolved, "activity", order))).toEqual([1, 2]);
  });

  // Timestamps are second-granular (the store writes RFC3339), so a batch of
  // comments created in one pass ties constantly. Without the id tie-break the
  // order would be whatever the input happened to be.
  it("breaks ties on id in every sort", () => {
    for (const sort of COMMENT_SORTS) {
      const out = sortComments(
        [comment(7, { filePath: "src/a.ts" }), comment(3, { filePath: "src/a.ts" }), comment(5, { filePath: "src/a.ts" })],
        sort.value,
        order
      );
      expect(ids(out), `sort=${sort.value}`).toEqual([3, 5, 7]);
    }
  });

  it("puts a file the explorer doesn't list after the ones it does", () => {
    const out = sortComments(
      [comment(1, { filePath: "unlisted.ts" }), comment(2, { filePath: "src/b.ts" })],
      "file",
      order
    );
    expect(ids(out)).toEqual([2, 1]);
  });

  it("returns an empty list unchanged", () => {
    expect(sortComments([], "file", order)).toEqual([]);
  });
});
