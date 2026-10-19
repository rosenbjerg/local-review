import {
  createHighlighterCore,
  type HighlighterCore,
  type ThemedToken,
  type ThemeRegistrationAny,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages, bundledLanguagesInfo, type BundledLanguage } from "shiki/langs";
import githubDark from "@shikijs/themes/github-dark";
import githubLight from "@shikijs/themes/github-light";
import materialTheme from "@shikijs/themes/material-theme";
import catppuccinMocha from "@shikijs/themes/catppuccin-mocha";
import catppuccinLatte from "@shikijs/themes/catppuccin-latte";
import darkPlus from "@shikijs/themes/dark-plus";
import lightPlus from "@shikijs/themes/light-plus";
import monokai from "@shikijs/themes/monokai";
import { darcula } from "./themes/darcula";
import { riderNight, riderDay } from "./themes/rider";
import { webstormDark, webstormLight } from "./themes/webstorm";
import { themeOf, type ShikiTheme, type ThemeId } from "./theme";

export type Token = ThemedToken;

// All registered up front: a token's color is resolved at tokenize time, so a theme must exist before first use.
const SHIKI_THEMES: Record<ShikiTheme, ThemeRegistrationAny> = {
  "github-dark": githubDark,
  "github-light": githubLight,
  darcula,
  "rider-night": riderNight,
  "rider-day": riderDay,
  "webstorm-dark": webstormDark,
  "webstorm-light": webstormLight,
  "material-theme": materialTheme,
  "catppuccin-mocha": catppuccinMocha,
  "catppuccin-latte": catppuccinLatte,
  "dark-plus": darkPlus,
  "light-plus": lightPlus,
  monokai,
};

const ALIAS_TO_ID = new Map<string, string>();
for (const info of bundledLanguagesInfo) {
  ALIAS_TO_ID.set(info.id, info.id);
  for (const alias of info.aliases ?? []) ALIAS_TO_ID.set(alias, info.id);
}

// Extensions that are neither a language id nor one of Shiki's aliases. Every value has to be one
// of the two, or `langForPath` silently returns null and the file renders unhighlighted —
// `highlight.test.ts` is what catches that.
export const EXT_EXTRA: Record<string, string> = {
  h: "c",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  htm: "html",
  feature: "gherkin",

  xcstrings: "json",
  webmanifest: "json",
  geojson: "json",
  topojson: "json",
  arb: "json",
  avsc: "json",
  har: "json",
  ipynb: "json",
  babelrc: "json",
  eslintrc: "json",
  prettierrc: "json",
  swcrc: "json",
  ndjson: "jsonl",

  svg: "xml",
  plist: "xml",
  entitlements: "xml",
  stringsdict: "xml",
  storyboard: "xml",
  xib: "xml",
  resx: "xml",
  xaml: "xml",
  axaml: "xml",
  csproj: "xml",
  fsproj: "xml",
  vbproj: "xml",
  props: "xml",
  targets: "xml",
  nuspec: "xml",
};

export const NAME_EXTRA: Record<string, string> = {
  dockerfile: "docker",
  containerfile: "docker",
  makefile: "make",
  gnumakefile: "make",
  jenkinsfile: "groovy",
  gemfile: "ruby",
  rakefile: "ruby",
  podfile: "ruby",
  vagrantfile: "ruby",
  "cmakelists.txt": "cmake",
};

export const PLAIN_TEXT = "text";

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).toLowerCase();
}

function builtIn(name: string): string | undefined {
  const named = NAME_EXTRA[name];
  if (named) return ALIAS_TO_ID.get(named);
  const dot = name.lastIndexOf(".");
  if (dot < 0) return undefined;
  const ext = name.slice(dot + 1);
  return ALIAS_TO_ID.get(EXT_EXTRA[ext] ?? ext);
}

export function langForPath(path: string): string | null {
  return builtIn(baseName(path)) ?? null;
}

export type LangMap = Record<string, string>;

function lookup(map: LangMap, name: string): string | undefined {
  const lang = map[name];
  if (lang !== undefined) return lang;
  for (let i = name.indexOf("."); i >= 0; i = name.indexOf(".", i + 1)) {
    const suffix = map[name.slice(i)];
    if (suffix !== undefined) return suffix;
  }
  return undefined;
}

function grammar(lang: string | undefined): string | undefined {
  if (lang === undefined) return undefined;
  return lang === PLAIN_TEXT ? PLAIN_TEXT : ALIAS_TO_ID.get(lang);
}

const LINGUIST_EXTRA: Record<string, string> = {
  text: PLAIN_TEXT,
  batchfile: "bat",
  "json-with-comments": "jsonc",
  "protocol-buffer": "proto",
  "java-properties": "ini",
  restructuredtext: "rst",
  "html+erb": "erb",
};

export function langForLinguist(name: string): string | undefined {
  const n = name.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (n === "") return undefined;
  return grammar(LINGUIST_EXTRA[n] ?? n) ?? ALIAS_TO_ID.get(n.replace(/-/g, ""));
}

export interface LangLayers {
  repo: LangMap;
  global: LangMap;
  attribute?: string;
}

export function resolveLang(path: string, layers: LangLayers): string | null {
  const name = baseName(path);
  const lang =
    grammar(lookup(layers.repo, name)) ??
    (layers.attribute ? langForLinguist(layers.attribute) : undefined) ??
    grammar(lookup(layers.global, name)) ??
    builtIn(name);
  return lang === undefined || lang === PLAIN_TEXT ? null : lang;
}

export const LANGUAGES: readonly { id: string; name: string }[] = [
  { id: PLAIN_TEXT, name: "Plain text" },
  ...bundledLanguagesInfo.map(({ id, name }) => ({ id, name })),
];

export function languageName(id: string): string {
  return LANGUAGES.find((l) => l.id === id)?.name ?? id;
}

export function langForInfo(info: string): string | null {
  const token = info.trim().split(/\s+/)[0].toLowerCase();
  if (!token) return null;
  return ALIAS_TO_ID.get(token) ?? ALIAS_TO_ID.get(EXT_EXTRA[token] ?? "") ?? null;
}

let hlPromise: Promise<HighlighterCore> | null = null;
function highlighter(): Promise<HighlighterCore> {
  if (!hlPromise) {
    hlPromise = createHighlighterCore({
      themes: Object.values(SHIKI_THEMES),
      langs: [],
      // Pure-JS engine, no wasm; `forgiving` skips the few oniguruma-only patterns instead of throwing.
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  }
  return hlPromise;
}

const loaded = new Set<string>();

// Tokens carry the theme's resolved colors — re-tokenize when the theme changes.
export async function tokenize(
  code: string,
  lang: string,
  theme: ThemeId
): Promise<Token[][] | null> {
  if (!(lang in bundledLanguages)) return null;
  try {
    const hl = await highlighter();
    if (!loaded.has(lang)) {
      await hl.loadLanguage(bundledLanguages[lang as BundledLanguage]);
      loaded.add(lang);
    }
    return hl.codeToTokens(code, { lang: lang as any, theme: themeOf(theme).shiki }).tokens;
  } catch {
    return null;
  }
}

// Swaps each fenced block in rendered-markdown HTML for Shiki spans; null when nothing was highlighted.
export async function highlightBlocks(baseHtml: string, theme: ThemeId): Promise<string | null> {
  const doc = new DOMParser().parseFromString(baseHtml, "text/html");
  const blocks = [...doc.querySelectorAll("pre > code[class*='language-']")];
  let changed = false;
  await Promise.all(
    blocks.map(async (code) => {
      const cls = [...code.classList].find((c) => c.startsWith("language-"));
      const lang = cls && langForInfo(cls.slice("language-".length));
      if (!lang) return;
      const lines = await tokenize(code.textContent ?? "", lang, theme);
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
