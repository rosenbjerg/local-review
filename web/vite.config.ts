import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// emptyOutDir wipes dist/ (including the tracked .gitkeep) on every build.
// Recreate the placeholder afterwards so the directory stays present for the
// Go `embed` directive on a fresh clone, without churning git.
function preserveGitkeep(): Plugin {
  return {
    name: "preserve-gitkeep",
    closeBundle() {
      writeFileSync(resolve(import.meta.dirname, "dist/.gitkeep"), "");
    },
  };
}

// React Compiler auto-memoizes components (see COMPILER.md). Infer mode (default)
// compiles the whole app and safely bails on functions it can't prove pure (the
// two render-time-ref hooks). target:'18' emits calls to react-compiler-runtime,
// since the useMemoCache hook is built into React 19 only.
const reactCompiler: [string, Record<string, unknown>] = [
  "babel-plugin-react-compiler",
  { target: "18" },
];

// Frontend builds into dist/, which the Go binary embeds.
// In dev, proxy the API to the Go server so both run side by side.
export default defineConfig({
  plugins: [react({ babel: { plugins: [reactCompiler] } }), preserveGitkeep()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:7777",
    },
  },
});
