import { describe, expect, it } from "vitest";
import { nextUnreviewed } from "./reviewNav";

const files = ["a.ts", "b.ts", "c.ts", "d.ts"];

describe("nextUnreviewed", () => {
  it("returns the next file after the current one", () => {
    expect(nextUnreviewed(files, "a.ts", new Set())).toBe("b.ts");
  });

  it("skips files already reviewed", () => {
    expect(nextUnreviewed(files, "a.ts", new Set(["b.ts", "c.ts"]))).toBe("d.ts");
  });

  it("wraps past the end to unreviewed files before the current one", () => {
    expect(nextUnreviewed(files, "c.ts", new Set(["d.ts"]))).toBe("a.ts");
  });

  it("never returns the current file, even when it is unreviewed", () => {
    expect(nextUnreviewed(files, "b.ts", new Set(["a.ts", "c.ts", "d.ts"]))).toBeNull();
  });

  it("returns null when every other file is reviewed", () => {
    expect(nextUnreviewed(files, "a.ts", new Set(["b.ts", "c.ts", "d.ts"]))).toBeNull();
  });

  it("starts at the first file when there is no current one", () => {
    expect(nextUnreviewed(files, null, new Set())).toBe("a.ts");
    expect(nextUnreviewed(files, null, new Set(["a.ts"]))).toBe("b.ts");
  });

  it("starts at the first file when the current one is not in the list", () => {
    expect(nextUnreviewed(files, "gone.ts", new Set(["a.ts"]))).toBe("b.ts");
  });

  it("handles an empty list and a single file", () => {
    expect(nextUnreviewed([], null, new Set())).toBeNull();
    expect(nextUnreviewed(["a.ts"], "a.ts", new Set())).toBeNull();
    expect(nextUnreviewed(["a.ts"], null, new Set())).toBe("a.ts");
  });
});
