import { afterEach, expect, test } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { SettingsModal } from "./components/SettingsModal";
import { DEFAULT_PREF, setThemePref } from "./theme";

afterEach(() => setThemePref(DEFAULT_PREF));

// The picker isn't review state: it reads and writes the theme store directly, and
// the store moves <html data-theme>, which is what the token blocks key on. It shows
// the stored preference — System by default, which resolves dark under jsdom — so
// following the OS stays visibly selected rather than showing as the theme it landed on.
test("the theme picker shows the stored preference and switches it", () => {
  render(<SettingsModal onClose={() => {}} />);
  const picker = screen.getByLabelText("Theme") as HTMLInputElement;
  expect(picker.value).toBe("System");
  expect(document.documentElement.dataset.theme).toBe("github-dark");

  fireEvent.click(picker);
  fireEvent.mouseDown(screen.getByText("GitHub Light"));
  expect(picker.value).toBe("GitHub Light");
  expect(document.documentElement.dataset.theme).toBe("github-light");
});

// A row is painted by the theme's own token block answering to data-theme, so the id on the row is
// the whole mechanism — there is no palette in TypeScript to fall back on.
test("each theme row carries the id that paints it", () => {
  render(<SettingsModal onClose={() => {}} />);
  fireEvent.click(screen.getByLabelText("Theme"));

  const row = screen.getByText("JetBrains Darcula").closest("li")!;
  expect(row.getAttribute("data-theme")).toBe("darcula");
  expect(row.className).toContain("theme-option");
});

// The `?` overlay's whole content lives here now, so the dialog has to still be the
// place a reviewer looks up a key — and the repo link came along with it.
test("it holds the shortcut list and the repo link", () => {
  render(<SettingsModal onClose={() => {}} />);

  expect(screen.getByText("Keyboard shortcuts")).toBeTruthy();
  expect(screen.getByText("Next / previous file")).toBeTruthy();
  expect(screen.getByText(/local-review on GitHub/).getAttribute("href")).toBe(
    "https://github.com/rosenbjerg/local-review"
  );
});

// The fonts are not review state either: the fields carry this repo's own picks straight to <html>,
// where an inline custom property is what outranks the theme block's --font-mono. An empty field
// shows what it would fall back to instead.
test("a font field overrides the theme's face, and Reset hands it back", () => {
  render(<SettingsModal onClose={() => {}} />);
  const code = screen.getByLabelText("Code font") as HTMLInputElement;
  expect(code.placeholder).toBe("Monaspace Neon");

  fireEvent.change(code, { target: { value: "Berkeley Mono" } });
  expect(document.documentElement.style.getPropertyValue("--font-mono")).toBe(
    "Berkeley Mono, var(--mono-fallback)"
  );

  fireEvent.click(screen.getByText("Reset"));
  expect(document.documentElement.style.getPropertyValue("--font-mono")).toBe("");
});

// The groups refine the switch rather than duplicating it, so they go when it does — and their
// labels come from the font's own feature table, not from a list written here.
test("the ligature groups appear under the switch and only while it is on", () => {
  render(<SettingsModal onClose={() => {}} />);
  const box = screen.getByLabelText("Code ligatures") as HTMLInputElement;
  expect(box.checked).toBe(true);
  const arrows = screen.getByLabelText("Arrows") as HTMLInputElement;
  expect(arrows.checked).toBe(true);
  // ss06 is Markdown Strings, which is not part of what the switch means.
  expect(screen.queryByLabelText("Markdown Strings")).toBeNull();

  fireEvent.click(arrows);
  expect(document.documentElement.style.getPropertyValue("--code-features")).toContain('"liga" 0');
  fireEvent.click(screen.getByLabelText("Arrows"));

  fireEvent.click(box);
  expect(screen.queryByLabelText("Arrows")).toBeNull();
  // The font store outlives a render, so what this switched is switched back for the next test.
  fireEvent.click(screen.getByLabelText("Code ligatures"));
});

// The switch has to mean the same thing whichever face is in play, which is why it knows about the
// one it is turning off: calt is the ligatures in JetBrains Mono but texture healing in Monaspace.
test("the ligature switch composes features for the face in use", () => {
  render(<SettingsModal onClose={() => {}} />);
  const box = screen.getByLabelText("Code ligatures") as HTMLInputElement;
  expect(box.checked).toBe(true);
  expect(document.documentElement.style.getPropertyValue("--code-features")).toContain('"ss09" 1');

  fireEvent.click(box);
  const off = document.documentElement.style.getPropertyValue("--code-features");
  expect(off).toContain('"liga" 0');
  expect(off).not.toContain("calt");
});
