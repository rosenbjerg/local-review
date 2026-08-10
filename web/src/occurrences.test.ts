import { expect, test } from "vitest";
import { mapSpansToNodes, matchSpans, normalizeTerm } from "./occurrences";

test("a term is trimmed, and too-short or multi-line selections are rejected", () => {
  expect(normalizeTerm("  foo  ")).toBe("foo");
  expect(normalizeTerm("x + 1")).toBe("x + 1");
  expect(normalizeTerm("a")).toBeNull();
  expect(normalizeTerm("")).toBeNull();
  expect(normalizeTerm("   ")).toBeNull();
  expect(normalizeTerm("foo\nbar")).toBeNull();
});

test("an identifier-shaped term matches only on word boundaries", () => {
  expect(matchSpans("const foo = foobar + foo;", "foo")).toEqual([
    [6, 9],
    [21, 24],
  ]);
  expect(matchSpans("id width id_x xid id", "id")).toEqual([
    [0, 2],
    [18, 20],
  ]);
  expect(matchSpans("aaa", "aa")).toEqual([]);
  expect(matchSpans("$foo = $foo", "$foo")).toEqual([
    [0, 4],
    [7, 11],
  ]);
});

test("a term that isn't an identifier matches as a plain substring", () => {
  expect(matchSpans("foo.bar foo.baz", "foo.")).toEqual([
    [0, 4],
    [8, 12],
  ]);
  expect(matchSpans("y = x + 1; z = x + 1", "x + 1")).toEqual([
    [4, 9],
    [15, 20],
  ]);
  expect(matchSpans("----", "--")).toEqual([
    [0, 2],
    [2, 4],
  ]);
  expect(matchSpans("nothing here", "zzz")).toEqual([]);
});

test("spans map onto the text nodes that spell out the line", () => {
  expect(mapSpansToNodes([3, 4], [[0, 3]])).toEqual([
    { start: { node: 0, offset: 0 }, end: { node: 0, offset: 3 } },
  ]);
  expect(mapSpansToNodes([3, 4], [[2, 5]])).toEqual([
    { start: { node: 0, offset: 2 }, end: { node: 1, offset: 2 } },
  ]);
  expect(mapSpansToNodes([3, 4], [[3, 7]])).toEqual([
    { start: { node: 1, offset: 0 }, end: { node: 1, offset: 4 } },
  ]);
  expect(mapSpansToNodes([0, 3, 0, 2], [[0, 5]])).toEqual([
    { start: { node: 1, offset: 0 }, end: { node: 3, offset: 2 } },
  ]);
});

test("a span running past the end of the line is dropped, not clamped", () => {
  expect(mapSpansToNodes([3], [[0, 10]])).toEqual([]);
});

// The shape syntax highlighting produces: one text node per token, so a match
// lands on whole nodes only when the tokenizer happened to split there.
test("a tokenized line maps each match onto its own token node", () => {
  const tokens = ["const ", "foo", " = ", "foo", ";"];
  const spans = matchSpans(tokens.join(""), "foo");
  expect(
    mapSpansToNodes(
      tokens.map((t) => t.length),
      spans
    )
  ).toEqual([
    { start: { node: 1, offset: 0 }, end: { node: 1, offset: 3 } },
    { start: { node: 3, offset: 0 }, end: { node: 3, offset: 3 } },
  ]);
});
