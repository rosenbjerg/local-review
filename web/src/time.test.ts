import { describe, expect, it } from "vitest";
import { relativeDay } from "./time";

// The date the repo picker's order rests on, formatted the way it's ordered: by day.
const dayOffset = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

describe("relativeDay", () => {
  // Load-bearing: a YYYY-MM-DD string goes through Date() as *UTC* midnight, which
  // is the previous local day anywhere west of Greenwich — so today's own date would
  // read "yesterday" for most of the Americas. relativeDay parses the parts as local.
  it("calls today's date today, in the local timezone", () => {
    expect(relativeDay(dayOffset(0))).toBe("today");
  });

  it("names the recent days", () => {
    expect(relativeDay(dayOffset(1))).toBe("yesterday");
    expect(relativeDay(dayOffset(3))).toBe("3d ago");
    expect(relativeDay(dayOffset(6))).toBe("6d ago");
  });

  // Past a week the count stops being readable, so it falls back to the date itself.
  it("falls back to an absolute date beyond a week", () => {
    const out = relativeDay("2024-03-04");
    expect(out).not.toMatch(/ago|today|yesterday/);
    expect(out).toContain("2024");
  });

  // An undated repo (or a value the server couldn't produce) must render as no hint
  // at all, not "Invalid Date".
  it("returns nothing for a missing or unparseable date", () => {
    for (const bad of ["", "not-a-date", "2024", "2024-03"]) {
      expect(relativeDay(bad)).toBe("");
    }
  });
});
