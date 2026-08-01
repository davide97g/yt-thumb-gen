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
  // Two entries: the editor, and the headless render target the render service drives
  // (render.html → src/render.tsx). The second one ships in the same bundle on purpose —
  // it has to be the same canvas code, or server-side pictures would drift from exports.
  build: {
    rollupOptions: {
      input: {
        main: new URL("./index.html", import.meta.url).pathname,
        render: new URL("./render.html", import.meta.url).pathname,
      },
    },
  },
  // In production nginx proxies /api to the Bun service same-origin; this mirrors that for
  // `bun run dev`. VITE_API_PROXY points at a locally running server/ (see its README).
  server: {
    port: 5174,
    proxy: { "/api": { target: process.env.VITE_API_PROXY ?? "http://localhost:3000", changeOrigin: true } },
  },
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
