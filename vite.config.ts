import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Build stamp so a running build can be identified (shown discreetly in the UI +
// logged to the console). Commit falls back to "dev" outside a git checkout.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const commit = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
})();
const buildTime = new Date().toISOString().slice(0, 16).replace("T", " ");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5174 },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  resolve: {
    alias: { "@": "/src" },
    dedupe: ["react", "react-dom"],
  },
});
