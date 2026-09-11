#!/usr/bin/env bun
// Reports which files the React Compiler actually compiles.
//   bun scripts/compilercheck.ts [--check]
// --check fails on any bailout not in the baseline, for CI.
//
// A bailout is silent three times over: the build succeeds, the app works, and `bun run lint`
// says nothing — the compiler stops at the first error per function, and the diagnostics ESLint
// surfaces cover only some of the reasons, so the first one hit can map to no rule at all. What
// the file loses is auto-memoization, which is load-bearing wherever a `memo` boundary compares
// props by identity: DiffView, FileExplorer, useReview and useCommentActions were all bailing.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
// babel lives in web/node_modules; this script runs from the repo root like the other ones.
const require = createRequire(join(REPO_ROOT, "web/package.json"));
const babel = require("@babel/core");
// Resolved to a path too: babel resolves a plugin *name* against the file being compiled,
// which is under web/src, not against this script.
const COMPILER_PLUGIN = require.resolve("babel-plugin-react-compiler");
const SRC = join(REPO_ROOT, "web/src");
const BASELINE = join(import.meta.dir, "compiler-baseline.txt");

interface Bailout {
  file: string;
  reason: string;
  line: number | null;
}

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...sources(path));
      continue;
    }
    // Test files are excluded from the build tsconfig and lint, so they aren't shipped code.
    if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out.sort();
}

async function bailoutsIn(path: string): Promise<Bailout[]> {
  const file = relative(REPO_ROOT, path);
  const found: Bailout[] = [];
  await babel.transformAsync(readFileSync(path, "utf8"), {
    filename: path,
    plugins: [
      [
        COMPILER_PLUGIN,
        {
          // Match vite.config.ts: React 18 needs the react-compiler-runtime polyfill.
          target: "18",
          logger: {
            logEvent(_fn: unknown, event: any) {
              if (event.kind !== "CompileError") return;
              const detail = event.detail?.options ?? event.detail ?? {};
              found.push({
                file,
                reason: String(detail.reason ?? "unknown"),
                line: detail.details?.[0]?.loc?.start?.line ?? null,
              });
            },
          },
        },
      ],
    ],
    parserOpts: { plugins: ["typescript", "jsx"] },
    configFile: false,
    babelrc: false,
  });
  return found;
}

// A baseline entry is `<file>\t<reason>`; the line moves with any edit above it, so it is
// deliberately not part of the identity.
const keyOf = (b: Bailout) => `${b.file}\t${b.reason}`;

function readBaseline(): Set<string> {
  try {
    return new Set(
      readFileSync(BASELINE, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== "" && !l.startsWith("#"))
    );
  } catch {
    return new Set();
  }
}

const check = process.argv.includes("--check");
const files = sources(SRC);
// One file at a time: the compiler holds its logger in module state, so concurrent runs
// report each other's bailouts and the baseline fills up with files that are actually fine.
const bailouts: Bailout[] = [];
for (const file of files) bailouts.push(...(await bailoutsIn(file)));
const baseline = readBaseline();
const seen = new Set(bailouts.map(keyOf));

const fresh = bailouts.filter((b) => !baseline.has(keyOf(b)));
// A baselined entry that no longer bails has been fixed: take it off the list rather than
// letting the list rot into a record of problems nobody has any more.
const stale = [...baseline].filter((k) => !seen.has(k));

console.log(`${files.length - new Set(bailouts.map((b) => b.file)).size}/${files.length} files compiled`);

for (const b of bailouts) {
  const known = baseline.has(keyOf(b)) ? "  (known)" : "  NEW";
  console.log(`  ✗ ${b.file}${b.line ? `:${b.line}` : ""}${known}\n      ${b.reason}`);
}
for (const k of stale) {
  console.log(`  ✓ ${k.split("\t")[0]} no longer bails — drop it from the baseline\n      ${k.split("\t")[1]}`);
}

if (!check) {
  writeFileSync(BASELINE, header() + [...seen].sort().join("\n") + (seen.size ? "\n" : ""));
  console.log(`\nbaseline written: ${relative(REPO_ROOT, BASELINE)} (${seen.size} entr${seen.size === 1 ? "y" : "ies"})`);
  process.exit(0);
}

if (fresh.length > 0 || stale.length > 0) {
  console.error(
    `\n${fresh.length} new bailout(s), ${stale.length} stale baseline entr(y/ies).` +
      `\nRun \`bun scripts/compilercheck.ts\` to update the baseline once the diff is intentional.`
  );
  process.exit(1);
}

function header(): string {
  return [
    "# Files the React Compiler cannot compile, one `<path>\\treason` per line.",
    "# Regenerate with `bun scripts/compilercheck.ts`; CI runs it with --check.",
    "# A bailout costs that file its auto-memoization — which is load-bearing wherever a",
    "# `memo` boundary compares props by identity. Prefer fixing the syntax to adding a line.",
    "",
  ].join("\n");
}
