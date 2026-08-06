import { describe, expect, it } from "vitest";
import type { Hunk } from "./types";
import { hunkWordRanges, splitPieces, tokenizeLine, wordDiff } from "./wordDiff";

const slice = (line: string, ranges: [number, number][]) =>
  ranges.map(([s, e]) => line.slice(s, e));

describe("tokenizeLine", () => {
  it("splits into words, whitespace runs and single punctuation", () => {
    expect(tokenizeLine("a = f(x);")).toEqual(["a", " ", "=", " ", "f", "(", "x", ")", ";"]);
  });

  it("keeps non-ASCII letters inside a word", () => {
    expect(tokenizeLine("größe")).toEqual(["größe"]);
  });
});

describe("wordDiff", () => {
  it("marks only the changed word", () => {
    const a = "const total = price * quantity;";
    const b = "const total = price * amount;";
    const d = wordDiff(a, b)!;
    expect(slice(a, d.del)).toEqual(["quantity"]);
    expect(slice(b, d.add)).toEqual(["amount"]);
  });

  it("marks a pure insertion on the new side only", () => {
    const a = "call(x)";
    const b = "call(x, y)";
    const d = wordDiff(a, b)!;
    expect(d.del).toEqual([]);
    expect(slice(b, d.add)).toEqual([", y"]);
  });

  it("marks a pure deletion on the old side only", () => {
    const a = "call(x, y)";
    const b = "call(x)";
    const d = wordDiff(a, b)!;
    expect(slice(a, d.del)).toEqual([", y"]);
    expect(d.add).toEqual([]);
  });

  it("merges adjacent changes into one range", () => {
    const a = "let a = 1;";
    const b = "let bb = 2;";
    const d = wordDiff(a, b)!;
    expect(d.del.length).toBe(2);
    expect(slice(a, d.del)).toEqual(["a", "1"]);
  });

  it("finds several separate changes in one line", () => {
    const a = "fn(one, two, three)";
    const b = "fn(one, TWO, THREE)";
    const d = wordDiff(a, b)!;
    expect(slice(b, d.add)).toEqual(["TWO", "THREE"]);
  });

  it("returns null for lines too different to be an edit of each other", () => {
    expect(wordDiff("    return err", "    logger.debug(payload, ctx)")).toBeNull();
  });

  it("returns null when the whole line changed on both sides", () => {
    expect(wordDiff("aaa", "bbb")).toBeNull();
  });

  it("returns null for identical lines", () => {
    expect(wordDiff("same", "same")).toBeNull();
  });

  it("gives up on lines long enough to make matching expensive", () => {
    const long = "x".repeat(1200);
    expect(wordDiff(long, long + "y")).toBeNull();
  });

  it("marks an indentation-only change", () => {
    const a = "  value";
    const b = "    value";
    const d = wordDiff(a, b)!;
    expect(slice(b, d.add)).toEqual(["    "]);
  });
});

const hunk = (lines: Hunk["lines"]): Hunk => ({ header: "@@", lines });

describe("hunkWordRanges", () => {
  it("pairs a del run with the add run that follows it, keyed by line number", () => {
    const ranges = hunkWordRanges([
      hunk([
        { kind: "context", oldLine: 1, newLine: 1, content: "start" },
        { kind: "del", oldLine: 2, content: "let a = 1;" },
        { kind: "del", oldLine: 3, content: "let b = 2;" },
        { kind: "add", newLine: 2, content: "let a = 10;" },
        { kind: "add", newLine: 3, content: "let b = 20;" },
      ]),
    ]);
    expect(slice("let a = 1;", ranges.del.get(2)!)).toEqual(["1"]);
    expect(slice("let a = 10;", ranges.add.get(2)!)).toEqual(["10"]);
    expect(slice("let b = 20;", ranges.add.get(3)!)).toEqual(["20"]);
  });

  it("leaves a deletion with no following addition unmarked", () => {
    const ranges = hunkWordRanges([
      hunk([{ kind: "del", oldLine: 4, content: "gone()" }]),
    ]);
    expect(ranges.del.size).toBe(0);
    expect(ranges.add.size).toBe(0);
  });

  it("pairs as far as the shorter run and drops the mismatched pair", () => {
    const ranges = hunkWordRanges([
      hunk([
        { kind: "del", oldLine: 1, content: "value = compute(a)" },
        { kind: "add", newLine: 1, content: "value = compute(b)" },
        { kind: "add", newLine: 2, content: "log(value)" },
      ]),
    ]);
    expect(slice("value = compute(b)", ranges.add.get(1)!)).toEqual(["b"]);
    expect(ranges.add.has(2)).toBe(false);
  });
});

describe("splitPieces", () => {
  const segs = (...texts: string[]) => texts.map((text) => ({ text }));

  it("cuts a single segment at the range boundaries", () => {
    expect(splitPieces(segs("abcdef"), [[2, 4]])).toEqual([
      { text: "ab", color: undefined, changed: false },
      { text: "cd", color: undefined, changed: true },
      { text: "ef", color: undefined, changed: false },
    ]);
  });

  it("carries each segment's colour onto its pieces", () => {
    const pieces = splitPieces([{ text: "abcd", color: "#f00" }], [[1, 3]]);
    expect(pieces.map((p) => p.color)).toEqual(["#f00", "#f00", "#f00"]);
    expect(pieces.map((p) => p.changed)).toEqual([false, true, false]);
  });

  it("splits a range that straddles two segments", () => {
    const pieces = splitPieces(segs("abc", "def"), [[2, 4]]);
    expect(pieces.filter((p) => p.changed).map((p) => p.text)).toEqual(["c", "d"]);
    expect(pieces.map((p) => p.text).join("")).toBe("abcdef");
  });

  it("applies several ranges across several segments", () => {
    const pieces = splitPieces(segs("ab", "cd", "ef"), [
      [0, 1],
      [4, 6],
    ]);
    expect(pieces.filter((p) => p.changed).map((p) => p.text)).toEqual(["a", "ef"]);
    expect(pieces.map((p) => p.text).join("")).toBe("abcdef");
  });

  it("clamps a range reaching past the end of the text", () => {
    const pieces = splitPieces(segs("abc"), [[1, 99]]);
    expect(pieces.map((p) => p.text).join("")).toBe("abc");
    expect(pieces.filter((p) => p.changed).map((p) => p.text)).toEqual(["bc"]);
  });

  it("preserves the full text with no ranges", () => {
    expect(splitPieces(segs("abc", "def"), []).map((p) => p.text).join("")).toBe("abcdef");
  });
});
