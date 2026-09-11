/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Test-only Vite config (takes precedence over vite.config.ts for `vitest`). Uses the
// react plugin WITHOUT the React Compiler: the compiler is its own plugin in
// vite.config.ts (see COMPILER.md), so `react()` alone is the plain Oxc JSX transform
// with no Babel in the pipeline at all.
//
// The usual rationale — auto-memoization is an optimization, not behavior — holds for
// the hook logic these tests are about, but it is not true at a `memo` boundary:
// DiffView compares props by identity, and whether a handler keeps its identity is
// exactly what the compiler decides. So nothing under vitest can tell a compiled file
// from a bailed-out one, and four files were silently bailing out for a long time.
// `bun scripts/compilercheck.ts` is what covers that; adding the compiler here would
// cover it too, at the cost of reworking diffViewMemo's render counter (the compiler
// memoizes the mocked FileHeader, so it stops proxying "the card re-rendered").
// jsdom gives the hooks a DOM (localStorage, EventSource via vitest.setup).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
