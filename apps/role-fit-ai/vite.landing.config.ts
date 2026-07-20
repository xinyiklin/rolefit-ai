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
  publicDir: false,
  plugins: [dropCspInDev],
  build: {
    outDir: resolve(appRoot, "dist-landing"),
    emptyOutDir: true,
    manifest: true,
  },
});
