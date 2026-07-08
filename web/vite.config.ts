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

// Frontend builds into dist/, which the Go binary embeds.
// In dev, proxy the API to the Go server so both run side by side.
export default defineConfig({
  plugins: [react(), preserveGitkeep()],
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
