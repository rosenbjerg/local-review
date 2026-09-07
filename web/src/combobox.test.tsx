import { expect, test } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { Combobox, type ComboOption } from "./components/Combobox";

// The from picker's list is a timeline, newest first, and a pick means "from here
// onward" — which rows of sha + subject can't say on their own. The range preview
// says it: the row under the pointer is the origin, every rail row above it is
// included, and a row that isn't on the rail (All) includes them all. The classes
// are the contract the CSS draws from, so they're what's pinned.

const options: ComboOption[] = [
  { value: "all", label: "All (whole branch)" },
  { value: "c3", label: "c3 newest", rail: true },
  { value: "c2", label: "c2 middle", rail: true },
  { value: "c1", label: "c1 oldest", rail: true },
];

function open(value = "all", rangePreview = true) {
  render(
    <Combobox
      ariaLabel="diff from"
      value={value}
      options={options}
      onChange={() => {}}
      rangePreview={rangePreview}
    />
  );
  fireEvent.click(screen.getByRole("combobox"));
}

function classesOf(label: string): string[] {
  return (screen.getByText(label).closest("li")?.className ?? "").split(" ").filter(Boolean);
}

test("hovering a commit includes it and every commit above it, not those below", () => {
  open();
  fireEvent.mouseEnter(screen.getByText("c2 middle").closest("li")!);

  expect(classesOf("All (whole branch)")).not.toContain("rail");
  expect(classesOf("All (whole branch)")).not.toContain("included");
  expect(classesOf("c3 newest")).toEqual(
    expect.arrayContaining(["rail", "rail-first", "included", "included-first"])
  );
  expect(classesOf("c3 newest")).not.toContain("origin");
  expect(classesOf("c2 middle")).toEqual(
    expect.arrayContaining(["rail", "included", "included-last", "origin"])
  );
  expect(classesOf("c1 oldest")).toEqual(expect.arrayContaining(["rail", "rail-last"]));
  expect(classesOf("c1 oldest")).not.toContain("included");
});

test("hovering All includes every commit, with no origin", () => {
  open("c2");
  fireEvent.mouseEnter(screen.getByText("All (whole branch)").closest("li")!);

  for (const label of ["c3 newest", "c2 middle", "c1 oldest"]) {
    expect(classesOf(label)).toContain("included");
    expect(classesOf(label)).not.toContain("origin");
  }
  expect(classesOf("c1 oldest")).toContain("included-last");
  expect(classesOf("All (whole branch)")).not.toContain("included");
  expect(classesOf("All (whole branch)")).toContain("active");
});

// The list opens on the current value, so the preview first shows the range that is
// already on screen; the arrow keys move the origin the way the pointer does.
test("the preview opens on the current pick and follows the keyboard", () => {
  open("c3");
  expect(classesOf("c3 newest")).toContain("origin");
  expect(classesOf("c2 middle")).not.toContain("included");

  fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
  expect(classesOf("c2 middle")).toContain("origin");
  expect(classesOf("c3 newest")).toContain("included");
  expect(classesOf("c3 newest")).not.toContain("origin");
});

test("a list without the preview draws no rail", () => {
  open("all", false);
  expect(screen.getByRole("listbox").className).not.toContain("range-list");
  for (const label of ["c3 newest", "c2 middle", "c1 oldest"]) {
    expect(classesOf(label)).not.toContain("rail");
    expect(classesOf(label)).not.toContain("included");
  }
});
