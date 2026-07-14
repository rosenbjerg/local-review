import { createHighlighterCore, type HighlighterCore, type ThemedToken } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages, bundledLanguagesInfo, type BundledLanguage } from "shiki/langs";
import githubDark from "@shikijs/themes/github-dark";

export type Token = ThemedToken;

const THEME = "github-dark";

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

// Resolve a fenced-code-block info string (```js, ```python, ```ts) to a Shiki
// language id via the same alias metadata paths do.
export function langForInfo(info: string): string | null {
  const token = info.trim().split(/\s+/)[0].toLowerCase();
  if (!token) return null;
  return ALIAS_TO_ID.get(token) ?? ALIAS_TO_ID.get(EXT_EXTRA[token] ?? "") ?? null;
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

export async function tokenize(code: string, lang: string): Promise<Token[][] | null> {
  if (!(lang in bundledLanguages)) return null;
  try {
    const hl = await highlighter();
    if (!loaded.has(lang)) {
      await hl.loadLanguage(bundledLanguages[lang as BundledLanguage]);
      loaded.add(lang);
    }
    return hl.codeToTokens(code, { lang: lang as any, theme: THEME }).tokens;
  } catch {
    return null;
  }
}

// Second pass over rendered-markdown HTML: swap each fenced block's plain text
// for Shiki's github-dark colored spans (the same tokens the diff view renders).
// Async because grammars load lazily; callers show the plain text until it
// resolves. Returns null when nothing was highlighted (no known-language fence).
export async function highlightBlocks(baseHtml: string): Promise<string | null> {
  const doc = new DOMParser().parseFromString(baseHtml, "text/html");
  const blocks = [...doc.querySelectorAll("pre > code[class*='language-']")];
  let changed = false;
  await Promise.all(
    blocks.map(async (code) => {
      const cls = [...code.classList].find((c) => c.startsWith("language-"));
      const lang = cls && langForInfo(cls.slice("language-".length));
      if (!lang) return;
      const lines = await tokenize(code.textContent ?? "", lang);
      if (!lines) return;
      code.replaceChildren();
      lines.forEach((line, i) => {
        if (i > 0) code.append("\n");
        for (const t of line) {
          const span = doc.createElement("span");
          span.style.color = t.color ?? "";
          span.textContent = t.content;
          code.append(span);
        }
      });
      changed = true;
    })
  );
  return changed ? doc.body.innerHTML : null;
}
