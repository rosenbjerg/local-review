import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import {
  removeLangMapping,
  setLangMapRepo,
  setLangMapping,
  useLangFor,
  useLangMap,
} from "./langMap";
import { LS, MAX_LANG_MAPPINGS, getJSON } from "./storage";

beforeEach(() => localStorage.clear());

test("a repo's mapping stays with that repo and layers over every repo's", () => {
  setLangMapRepo("/repo-a");
  act(() => {
    setLangMapping("global", "*.steps", "gherkin");
    setLangMapping("repo", ".h", "cpp");
  });
  const { result } = renderHook(() => [useLangFor("a.h"), useLangFor("x.steps")]);
  expect(result.current).toEqual(["cpp", "gherkin"]);
  expect(getJSON(LS.langMapByRepo, {})).toEqual({ "/repo-a": { ".h": "cpp" } });
  expect(getJSON(LS.langMap, {})).toEqual({ ".steps": "gherkin" });

  act(() => setLangMapRepo("/repo-b"));
  expect(result.current).toEqual(["c", "gherkin"]);
});

test("a .gitattributes language sits between the repo's mapping and every repo's", () => {
  setLangMapRepo("/repo-c");
  act(() => setLangMapping("global", ".h", "objective-c"));
  const { result } = renderHook(() => useLangFor("a.h", "C++"));
  expect(result.current).toBe("cpp");
  act(() => setLangMapping("repo", ".h", "c"));
  expect(result.current).toBe("c");
});

test("removing a repo's last mapping drops its entry", () => {
  setLangMapRepo("/repo-d");
  act(() => setLangMapping("repo", "Jenkinsfile", "groovy"));
  expect(renderHook(() => useLangMap()).result.current.own).toEqual({ jenkinsfile: "groovy" });
  act(() => removeLangMapping("repo", "jenkinsfile"));
  expect(getJSON(LS.langMapByRepo, {})).toEqual({});
});

test("a key that can't name a file is refused", () => {
  setLangMapRepo("/repo-e");
  expect(setLangMapping("repo", "src/*.ts", "typescript")).toBe(false);
  expect(setLangMapping("repo", "  ", "typescript")).toBe(false);
  expect(setLangMapping("repo", ".", "typescript")).toBe(false);
  expect(renderHook(() => useLangMap()).result.current.own).toEqual({});
});

test("a full scope refuses a new key but still takes a change to an existing one", () => {
  setLangMapRepo("/repo-f");
  act(() => {
    for (let i = 0; i < MAX_LANG_MAPPINGS; i++) setLangMapping("repo", `.x${i}`, "json");
  });

  expect(setLangMapping("repo", ".extra", "gherkin")).toBe(false);
  expect(setLangMapping("repo", ".x1", "yaml")).toBe(true);
  const stored = getJSON<Record<string, Record<string, string>>>(LS.langMapByRepo, {})["/repo-f"];
  expect(Object.keys(stored)).toHaveLength(MAX_LANG_MAPPINGS);
  expect(stored[".x1"]).toBe("yaml");
});
