import { afterEach, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import {
  DEFAULT_PREF,
  getTheme,
  isThemePref,
  readStoredPref,
  setThemePref,
  useTheme,
  useThemePref,
} from "./theme";
import { LS } from "./storage";

afterEach(() => {
  setThemePref(DEFAULT_PREF);
  localStorage.clear();
  vi.unstubAllGlobals();
});

// A theme can be removed or renamed after a browser stored its id; the stored value
// must then fall back rather than leave <html> with a data-theme no block matches.
test("a stored value counts only if it names a theme or 'system'", () => {
  localStorage.setItem(LS.theme, "github-light");
  expect(readStoredPref()).toBe("github-light");

  localStorage.setItem(LS.theme, "system");
  expect(readStoredPref()).toBe("system");

  localStorage.setItem(LS.theme, "solarized");
  expect(readStoredPref()).toBe(DEFAULT_PREF);

  localStorage.removeItem(LS.theme);
  expect(readStoredPref()).toBe(DEFAULT_PREF);
  expect(isThemePref("")).toBe(false);
});

// The store owns the <html> attribute: it's set at import (so the first paint is
// themed) and moves with every set, together with the stored value and every hook.
test("setThemePref moves the <html> attribute, the stored value and every subscriber together", () => {
  const { result } = renderHook(() => ({ theme: useTheme(), pref: useThemePref() }));
  // jsdom has no matchMedia, so the "system" default resolves dark here.
  expect(result.current).toEqual({ theme: "github-dark", pref: "system" });
  expect(document.documentElement.dataset.theme).toBe("github-dark");

  act(() => setThemePref("github-light"));
  expect(result.current).toEqual({ theme: "github-light", pref: "github-light" });
  expect(getTheme()).toBe("github-light");
  expect(document.documentElement.dataset.theme).toBe("github-light");
  expect(localStorage.getItem(LS.theme)).toBe("github-light");
});

// A prefers-color-scheme stub: `matches` is what the OS says now, and `flip` moves it
// the way the browser does when the desktop switches modes.
function stubScheme(dark: boolean) {
  type Listener = (e: { matches: boolean }) => void;
  const q = {
    matches: dark,
    listeners: new Set<Listener>(),
    addEventListener(_: string, l: Listener) {
      q.listeners.add(l);
    },
    removeEventListener(_: string, l: Listener) {
      q.listeners.delete(l);
    },
    flip(darkNow: boolean) {
      q.matches = darkNow;
      for (const l of q.listeners) l({ matches: darkNow });
    },
  };
  vi.stubGlobal("matchMedia", (query: string) => {
    expect(query).toBe("(prefers-color-scheme: dark)");
    return q;
  });
  return q;
}

test("'system' follows the OS between the two GitHub themes, until a theme is picked outright", async () => {
  const q = stubScheme(false);
  vi.resetModules();
  const t = await import("./theme"); // a fresh store, initialized against the stub
  expect(t.getTheme()).toBe("github-light");
  expect(t.resolveTheme("system")).toBe("github-light");

  q.flip(true);
  expect(t.getTheme()).toBe("github-dark");

  // An explicit pick stays put when the desktop flips…
  t.setThemePref("github-light");
  q.flip(false);
  q.flip(true);
  expect(t.getTheme()).toBe("github-light");

  // …and going back to System follows again, from the OS's current answer.
  t.setThemePref("system");
  expect(t.getTheme()).toBe("github-dark");
  q.flip(false);
  expect(t.getTheme()).toBe("github-light");
  q.flip(true);
});
