import { createHighlighterCore, type HighlighterCore, type ThemedToken } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages, bundledLanguagesInfo, type BundledLanguage } from "shiki/langs";
import githubDark from "@shikijs/themes/github-dark";

export type Token = ThemedToken;

const THEME = "github-dark";

// Every language id and alias → canonical id, derived from Shiki's own metadata
// so we cover all ~235 bundled languages without a maintained list. Each grammar
// is still lazily fetched (a separate chunk) only when a file needs it.
const ALIAS_TO_ID = new Map<string, string>();
for (const info of bundledLanguagesInfo) {
  ALIAS_TO_ID.set(info.id, info.id);
  for (const alias of info.aliases ?? []) ALIAS_TO_ID.set(alias, info.id);
}

// Extensions that are neither a language id nor one of Shiki's aliases.
const EXT_EXTRA: Record<string, string> = {
  h: "c",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  htm: "html",
};

export function langForPath(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  const candidate = EXT_EXTRA[ext] ?? ext;
  return ALIAS_TO_ID.get(candidate) ?? null;
}

let hlPromise: Promise<HighlighterCore> | null = null;
function highlighter(): Promise<HighlighterCore> {
  if (!hlPromise) {
    hlPromise = createHighlighterCore({
      themes: [githubDark],
      langs: [],
      // Pure-JS regex engine — no wasm to load in the browser. `forgiving`
      // skips the few oniguruma-only patterns instead of throwing.
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  }
  return hlPromise;
}

const loaded = new Set<string>();

// tokenize returns one token array per line, or null if the language is
// unsupported (caller falls back to plain text).
export async function tokenize(code: string, lang: string): Promise<Token[][] | null> {
  if (!(lang in bundledLanguages)) return null;
  try {
    const hl = await highlighter();
    if (!loaded.has(lang)) {
      await hl.loadLanguage(bundledLanguages[lang as BundledLanguage]);
      loaded.add(lang);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return hl.codeToTokens(code, { lang: lang as any, theme: THEME }).tokens;
  } catch {
    return null;
  }
}
