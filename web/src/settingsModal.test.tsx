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
  const picker = screen.getByLabelText("Theme") as HTMLSelectElement;
  expect(picker.value).toBe("system");
  expect(document.documentElement.dataset.theme).toBe("github-dark");

  fireEvent.change(picker, { target: { value: "github-light" } });
  expect(picker.value).toBe("github-light");
  expect(document.documentElement.dataset.theme).toBe("github-light");
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
