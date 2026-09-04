/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Test-only Vite config (takes precedence over vite.config.ts for `vitest`). Uses the
// react plugin WITHOUT the React Compiler — auto-memoization is a build optimization,
// not behavior, so the hook logic under test is identical and the transform stays
// simple. That's now just an omission: the compiler is its own plugin in
// vite.config.ts (see COMPILER.md), so `react()` alone is the plain Oxc JSX
// transform with no Babel in the pipeline at all.
// jsdom gives the hooks a DOM (localStorage, EventSource via vitest.setup).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
