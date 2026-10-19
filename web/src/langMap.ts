import { useSyncExternalStore } from "react";
import { resolveLang, type LangMap } from "./highlight";
import {
  LS,
  MAX_LANG_MAPPINGS,
  getString,
  normalizeLangKey,
  readLangDefaults,
  readLangOverrides,
  writeLangDefaults,
  writeLangOverrides,
} from "./storage";

export type LangScope = "repo" | "global";

export interface LangMapState {
  repo: string;
  own: LangMap;
  inherited: LangMap;
}

let state: LangMapState = {
  repo: getString(LS.repo),
  own: readLangOverrides(getString(LS.repo)),
  inherited: readLangDefaults(),
};
const listeners = new Set<() => void>();

function commit(next: LangMapState): void {
  state = next;
  for (const l of listeners) l();
}

// An empty repo is App's "nothing selected yet" first render, not a repo without mappings.
export function setLangMapRepo(next: string): void {
  if (next === "" || next === state.repo) return;
  commit({ ...state, repo: next, own: readLangOverrides(next) });
}

function write(scope: LangScope, map: LangMap): void {
  if (scope === "repo") {
    if (state.repo === "") return;
    writeLangOverrides(state.repo, map);
    commit({ ...state, own: readLangOverrides(state.repo) });
  } else {
    writeLangDefaults(map);
    commit({ ...state, inherited: readLangDefaults() });
  }
}

function mapOf(scope: LangScope): LangMap {
  return scope === "repo" ? state.own : state.inherited;
}

export function setLangMapping(scope: LangScope, rawKey: string, lang: string): boolean {
  const key = normalizeLangKey(rawKey);
  const map = mapOf(scope);
  if (key === "") return false;
  if (map[key] === undefined && Object.keys(map).length >= MAX_LANG_MAPPINGS) return false;
  write(scope, { ...map, [key]: lang });
  return true;
}

export function removeLangMapping(scope: LangScope, key: string): void {
  const next = { ...mapOf(scope) };
  delete next[key];
  write(scope, next);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getState(): LangMapState {
  return state;
}

export function useLangMap(): LangMapState {
  return useSyncExternalStore(subscribe, getState);
}

export function useLangFor(path: string, attribute?: string): string | null {
  const { own, inherited } = useLangMap();
  return resolveLang(path, { repo: own, global: inherited, attribute });
}
