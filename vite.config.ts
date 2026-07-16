import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The deployed custom domain serves from root, same as local dev.
  base: "/",
  server: {
    // Typeset owns 5186 (sibling reservations live in AGENTS.md). Pin it so a
    // bound port means "already running", and give HMR its own socket so it
    // doesn't collide with a sibling Vite on the default 24678.
    port: 5186,
    strictPort: true,
    hmr: { port: 24686 }
  },
  preview: {
    port: 5186,
    strictPort: true
  }
});
