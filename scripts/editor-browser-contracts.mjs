import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { createServer } from "vite";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(repoRoot, "scripts", "editor-browser-contracts");
const server = await createServer({
  root: fixtureRoot,
  plugins: [react()],
  logLevel: "error",
  server: {
    host: "127.0.0.1",
    port: 0,
    strictPort: false,
    fs: { allow: [repoRoot] }
  }
});

try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("The browser contract server did not expose a local port.");
  }
  const url = `http://127.0.0.1:${address.port}/`;
  const chromiumDriver = join(
    repoRoot,
    "scripts",
    "editor-browser-contracts-chromium.mjs"
  );
  const child = spawn(process.execPath, [chromiumDriver], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ROLEFIT_EDITOR_BROWSER_CONTRACT_URL: url
    },
    stdio: "inherit"
  });
  const result = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolveExit({ code: code ?? 1, signal })
    );
  });
  if (result.code !== 0) {
    throw new Error(
      `Chromium editor contracts failed${
        result.signal ? ` with ${result.signal}` : ` with exit ${result.code}`
      }.`
    );
  }
} finally {
  await server.close();
}
