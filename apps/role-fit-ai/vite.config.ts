import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Preserve the Vite 7 production baseline while Vite 8 raises its rolling
  // default. RoleFit is opened in the user's system browser by the companion.
  build: {
    target: ["chrome107", "edge107", "firefox104", "safari16", "ios16"],
  },
  server: {
    port: 5181
  }
});
