import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin } from "vite";

const appRoot = dirname(fileURLToPath(import.meta.url));

// The production CSP (style-src 'self', connect-src api.github.com) blocks the
// dev server's inline style injection and HMR websocket. Builds keep the meta.
const dropCspInDev: Plugin = {
  name: "landing-drop-csp-in-dev",
  apply: "serve",
  transformIndexHtml(html) {
    return html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>\s*/i, "");
  },
};

export default defineConfig({
  root: resolve(appRoot, "landing"),
  base: "/",
  publicDir: resolve(appRoot, "landing/public"),
  plugins: [dropCspInDev],
  build: {
    // Keep the public site on the Vite 7 browser baseline instead of silently
    // adopting Vite 8's newer Baseline Widely Available target.
    target: ["chrome107", "edge107", "firefox104", "safari16", "ios16"],
    outDir: resolve(appRoot, "dist-landing"),
    emptyOutDir: true,
    manifest: true,
  },
});
