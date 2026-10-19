import { expect, test } from "vitest";
import {
  EXT_EXTRA,
  NAME_EXTRA,
  langForInfo,
  langForLinguist,
  langForPath,
  resolveLang,
} from "./highlight";

// An EXT_EXTRA value Shiki doesn't know fails silently: langForPath returns null and the file just
// renders unhighlighted, which reads as "Shiki has no grammar for this" rather than as a typo.
// A Shiki upgrade that renames or drops a language lands here too.
test("every extension override names a language Shiki has", () => {
  const unresolved = Object.entries({ ...EXT_EXTRA, ...NAME_EXTRA }).filter(
    ([, lang]) => langForInfo(lang) === null
  );
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
  expect(langForPath("LICENSE")).toBeNull();
});

test("a file with no extension resolves by its whole name", () => {
  expect(langForPath("Dockerfile")).toBe("docker");
  expect(langForPath("ci/Jenkinsfile")).toBe("groovy");
  expect(langForPath("src/CMakeLists.txt")).toBe("cmake");
});

test("only the file name is read, never a dot in a directory", () => {
  expect(langForPath("v1.2/Makefile")).toBe("make");
  expect(langForPath("v1.2/LICENSE")).toBeNull();
});

test("a .feature file is Gherkin", () => {
  expect(langForPath("specs/login.feature")).toBe("gherkin");
});

const none = { repo: {}, global: {} };

test("a mapping names a file by extension, longest first, or by whole name", () => {
  const global = { ".ts": "javascript", ".d.ts": "typescript", jenkinsfile: "groovy" };
  expect(resolveLang("src/a.ts", { ...none, global })).toBe("javascript");
  expect(resolveLang("src/a.d.ts", { ...none, global })).toBe("typescript");
  expect(resolveLang("Jenkinsfile", { ...none, global })).toBe("groovy");
  expect(resolveLang("x.jenkinsfile", { ...none, global })).toBe(null);
});

test("this repo beats .gitattributes, which beats every repo, which beats the built-in", () => {
  const global = { ".h": "c" };
  expect(resolveLang("a.h", none)).toBe("c");
  expect(resolveLang("a.h", { ...none, global: { ".h": "objective-c" } })).toBe("objective-c");
  expect(resolveLang("a.h", { ...none, global, attribute: "C++" })).toBe("cpp");
  expect(resolveLang("a.h", { repo: { ".h": "objective-cpp" }, global, attribute: "C++" })).toBe(
    "objective-cpp"
  );
});

test("plain text switches highlighting off at any layer", () => {
  expect(resolveLang("a.json", { ...none, global: { ".json": "text" } })).toBeNull();
  expect(resolveLang("a.json", { ...none, attribute: "Text" })).toBeNull();
});

test("a language nothing knows falls through to the next layer", () => {
  expect(resolveLang("a.feature", { repo: { ".feature": "nope" }, global: {} })).toBe("gherkin");
  expect(resolveLang("a.feature", { ...none, attribute: "Klingon" })).toBe("gherkin");
});

test("Linguist's names land on Shiki's grammars", () => {
  expect(langForLinguist("Gherkin")).toBe("gherkin");
  expect(langForLinguist("C++")).toBe("cpp");
  expect(langForLinguist("C#")).toBe("csharp");
  expect(langForLinguist("Shell")).toBe("shellscript");
  expect(langForLinguist("Objective-C")).toBe("objective-c");
  expect(langForLinguist("Vim-Script")).toBe("viml");
  expect(langForLinguist("JSON-with-Comments")).toBe("jsonc");
  expect(langForLinguist("Batchfile")).toBe("bat");
  expect(langForLinguist("Emacs_Lisp")).toBe("emacs-lisp");
});
