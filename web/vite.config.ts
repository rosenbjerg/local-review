import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";

// emptyOutDir wipes the tracked dist/.gitkeep; recreate it so the Go `embed` directive compiles on a fresh clone.
function preserveGitkeep(): Plugin {
  return {
    name: "preserve-gitkeep",
    closeBundle() {
      writeFileSync(resolve(import.meta.dirname, "dist/.gitkeep"), "");
    },
  };
}

// React Compiler via Babel (plugin-react has had no `babel` option since v6); target "18" needs react-compiler-runtime.
// Not the native `react({ compiler: true })`: DiffView's memo comparator is tuned against this compiler's bailouts.
const reactCompiler = babel({
  presets: [reactCompilerPreset({ target: "18" })],
});

// dist/ is what the Go binary embeds; in dev the API is proxied to the Go server.
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
