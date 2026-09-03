import { afterEach, expect, test } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { DEFAULT_THEME, getTheme, isThemeId, readStoredTheme, setTheme, useTheme } from "./theme";
import { LS } from "./storage";

afterEach(() => {
  setTheme(DEFAULT_THEME);
  localStorage.clear();
});

// A theme can be removed or renamed after a browser stored its id; the stored value
// must then fall back rather than leave <html> with a data-theme no block matches.
test("a stored value counts only if it names a theme", () => {
  localStorage.setItem(LS.theme, "github-light");
  expect(readStoredTheme()).toBe("github-light");

  localStorage.setItem(LS.theme, "solarized");
  expect(readStoredTheme()).toBe(DEFAULT_THEME);

  localStorage.removeItem(LS.theme);
  expect(readStoredTheme()).toBe(DEFAULT_THEME);
  expect(isThemeId("")).toBe(false);
});

// The store owns the <html> attribute: it's set at import (so the first paint is
// themed) and moves with every set, together with the stored value and every hook.
test("setTheme moves the <html> attribute, the stored value and every subscriber together", () => {
  const { result } = renderHook(() => useTheme());
  expect(result.current).toBe(DEFAULT_THEME);
  expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME);

  act(() => setTheme("github-light"));
  expect(result.current).toBe("github-light");
  expect(getTheme()).toBe("github-light");
  expect(document.documentElement.dataset.theme).toBe("github-light");
  expect(localStorage.getItem(LS.theme)).toBe("github-light");
});
