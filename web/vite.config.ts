import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";

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
//
// It runs through Babel, as a second plugin: @vitejs/plugin-react itself uses Oxc
// (no Babel) since v6, so its old `babel` option is gone and the compiler is wired
// in via @rolldown/plugin-babel instead. `reactCompilerPreset` is the plugin's own
// helper — a preconfigured filter around babel-plugin-react-compiler, i.e. the same
// compiler this has always used, so the emitted memoization is unchanged.
// plugin-react also ships an experimental native (Rust) React Compiler behind
// `react({ compiler: true })`; deliberately not used, since DiffView's hand-written
// memo comparator is tuned against this compiler's actual bailouts.
const reactCompiler = babel({
  presets: [reactCompilerPreset({ target: "18" })],
});

// Frontend builds into dist/, which the Go binary embeds.
// In dev, proxy the API to the Go server so both run side by side.
export default defineConfig({
  plugins: [react(), reactCompiler, preserveGitkeep()],
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
