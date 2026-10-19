import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { LanguagesModal } from "./components/LanguagesModal";
import { setLangMapRepo, setLangMapping } from "./langMap";
import { LS, getJSON } from "./storage";

beforeEach(() => localStorage.clear());

function pick(combobox: HTMLElement, label: string) {
  fireEvent.click(combobox);
  fireEvent.change(combobox, { target: { value: label } });
  fireEvent.mouseDown(screen.getByRole("option", { name: label }));
}

test("a mapping added for every repo is stored under its normalized key", () => {
  setLangMapRepo("/modal-a");
  render(<LanguagesModal onClose={() => {}} onBack={() => {}} />);

  fireEvent.change(screen.getByLabelText("New every repo pattern"), {
    target: { value: "*.Steps" },
  });
  pick(screen.getByLabelText("New every repo language"), "Gherkin");
  fireEvent.click(screen.getAllByRole("button", { name: "Add" })[1]);

  expect(getJSON(LS.langMap, {})).toEqual({ ".steps": "gherkin" });
  const section = screen.getByRole("region", { name: "Every repo" });
  expect(within(section).getByText("*.steps")).toBeTruthy();
});

test("a repo mapping says which default it overrides, and goes on Remove", () => {
  setLangMapRepo("/modal-b");
  act(() => setLangMapping("repo", ".h", "cpp"));
  render(<LanguagesModal onClose={() => {}} onBack={() => {}} />);

  const section = screen.getByRole("region", { name: "This repo (/modal-b)" });
  const row = within(section).getByText("*.h").closest("tr")!;
  expect(within(row).getByText("over default: C")).toBeTruthy();
  fireEvent.click(within(row).getByRole("button", { name: "Remove" }));
  expect(getJSON(LS.langMapByRepo, {})).toEqual({});
});

test("a pattern naming a directory can't be added", () => {
  setLangMapRepo("/modal-c");
  render(<LanguagesModal onClose={() => {}} onBack={() => {}} />);

  fireEvent.change(screen.getByLabelText("New every repo pattern"), {
    target: { value: "src/*.ts" },
  });
  pick(screen.getByLabelText("New every repo language"), "TypeScript");
  expect(
    (screen.getAllByRole("button", { name: "Add" })[1] as HTMLButtonElement).disabled
  ).toBe(true);
});

test("an override of a grammar Shiki finds by itself still names it", () => {
  setLangMapRepo("/modal-d");
  act(() => setLangMapping("global", ".ts", "javascript"));
  render(<LanguagesModal onClose={() => {}} onBack={() => {}} />);

  const section = screen.getByRole("region", { name: "Every repo" });
  const row = within(section).getByText("*.ts").closest("tr")!;
  expect(within(row).getByText("over built-in: TypeScript")).toBeTruthy();
});
