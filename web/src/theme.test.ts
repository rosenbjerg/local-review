import { afterEach, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import {
  DEFAULT_PREF,
  getTheme,
  isThemePref,
  readStoredPref,
  setThemePref,
  setThemeRepo,
  useTheme,
  useThemePref,
} from "./theme";
import { LS, getJSON } from "./storage";

afterEach(() => {
  setThemePref(DEFAULT_PREF);
  localStorage.clear();
  vi.unstubAllGlobals();
});

// A theme can be removed or renamed after a browser stored its id; the stored value
// must then fall back rather than leave <html> with a data-theme no block matches.
test("a stored value counts only if it names a theme or 'system'", () => {
  localStorage.setItem(
    LS.themeByRepo,
    JSON.stringify({ web: "github-light", api: "system", cli: "solarized" })
  );
  expect(readStoredPref("web")).toBe("github-light");
  expect(readStoredPref("api")).toBe("system");
  expect(readStoredPref("cli")).toBe(DEFAULT_PREF);

  expect(readStoredPref("unthemed")).toBe(DEFAULT_PREF);
  expect(isThemePref("")).toBe(false);
});

// lr.theme, the one global choice the per-repo map replaced, stays the default a repo
// without a pick of its own shows — which is also the migration: a theme chosen before
// the split has to keep applying everywhere until a repo is themed outright.
test("a repo with no pick of its own falls back to the global default", () => {
  localStorage.setItem(LS.theme, "darcula");
  expect(readStoredPref("web")).toBe("darcula");

  localStorage.setItem(LS.themeByRepo, JSON.stringify({ web: "github-light" }));
  expect(readStoredPref("web")).toBe("github-light");
  expect(readStoredPref("api")).toBe("darcula");
});

// The store owns the <html> attribute: it's set at import (so the first paint is
// themed) and moves with every set, together with the stored value and every hook.
// No repo is selected here, so the pick lands on that global default.
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

// The whole point of the split: two repos, two themes, and switching between them
// repaints without either pick disturbing the other.
test("the pick is remembered per repo, and pointing the store at another repo repaints", () => {
  const { result } = renderHook(() => ({ theme: useTheme(), pref: useThemePref() }));

  act(() => setThemeRepo("web"));
  act(() => setThemePref("github-light"));
  expect(result.current).toEqual({ theme: "github-light", pref: "github-light" });
  expect(getJSON(LS.themeByRepo, {})).toEqual({ web: "github-light" });
  expect(localStorage.getItem(LS.theme)).toBe(null); // the repo's own pick, not the default

  // A repo with no pick of its own shows the default — and takes its own.
  act(() => setThemeRepo("api"));
  expect(result.current).toEqual({ theme: "github-dark", pref: "system" });
  expect(document.documentElement.dataset.theme).toBe("github-dark");
  act(() => setThemePref("darcula"));
  expect(getJSON(LS.themeByRepo, {})).toEqual({ web: "github-light", api: "darcula" });

  act(() => setThemeRepo("web"));
  expect(result.current).toEqual({ theme: "github-light", pref: "github-light" });
  expect(document.documentElement.dataset.theme).toBe("github-light");
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

// The store paints before React runs, so it seeds itself from the remembered repo
// (lr.repo, which is what useReview restores). App's first render carries the empty
// repo the list hasn't loaded into yet — taking that as a repo without a preference
// would flash the seeded theme away and back.
test("the store seeds from the remembered repo, and an empty repo leaves it standing", async () => {
  localStorage.setItem(LS.repo, "web");
  localStorage.setItem(LS.themeByRepo, JSON.stringify({ web: "darcula" }));
  vi.resetModules();
  const t = await import("./theme");
  expect(t.getTheme()).toBe("darcula");

  t.setThemeRepo("");
  expect(t.getTheme()).toBe("darcula");

  t.setThemeRepo("api");
  expect(t.getTheme()).toBe("github-dark");
});
