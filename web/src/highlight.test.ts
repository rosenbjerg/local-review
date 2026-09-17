import { expect, test } from "vitest";
import { EXT_EXTRA, langForInfo, langForPath } from "./highlight";

// An EXT_EXTRA value Shiki doesn't know fails silently: langForPath returns null and the file just
// renders unhighlighted, which reads as "Shiki has no grammar for this" rather than as a typo.
// A Shiki upgrade that renames or drops a language lands here too.
test("every extension override names a language Shiki has", () => {
  const unresolved = Object.entries(EXT_EXTRA).filter(([, lang]) => langForInfo(lang) === null);
  expect(unresolved).toEqual([]);
});

test("an alias resolves to the language it stands in for", () => {
  expect(langForPath("Sources/App/Localizable.xcstrings")).toBe("json");
  expect(langForPath("web/public/site.webmanifest")).toBe("json");
  expect(langForPath("App/Info.plist")).toBe("xml");
  expect(langForPath("App/App.entitlements")).toBe("xml");
  expect(langForPath("docs/logo.svg")).toBe("xml");
  expect(langForPath("src/Api.csproj")).toBe("xml");
  expect(langForPath("events.ndjson")).toBe("jsonl");
});

test("the extension is taken case-insensitively, and only the last one", () => {
  expect(langForPath("App/Info.PLIST")).toBe("xml");
  expect(langForPath("locales/app.en.arb")).toBe("json");
});

// A dotfile's whole name reads as its extension, which is how `.prettierrc` resolves at all.
test("a leading-dot config file resolves by its name", () => {
  expect(langForPath(".prettierrc")).toBe("json");
  expect(langForPath("web/.babelrc")).toBe("json");
});

test("an extension nothing claims stays unhighlighted", () => {
  expect(langForPath("notes.xyzzy")).toBeNull();
  expect(langForPath("Dockerfile")).toBeNull();
});
