// The source-development Vite server watches only what the client is served
// from. Watching the whole app root also watched the local workspace, its
// restore backups, and build output (thousands of paths); every fs.watch blocks
// the event loop, which froze the companion-owned server past its 750 ms health
// probe right after startup.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { developmentViteConfig } from "../runtime.ts";

// The probes below check the exported config, so the server must start from it.
assert.match(
  readFileSync(new URL("../runtime.ts", import.meta.url), "utf8"),
  /createViteServer\(developmentViteConfig\(appRoot, workspaceDir\)\)/,
  "the source server starts Vite from developmentViteConfig"
);

const appRoot = resolve("C:/rolefit/apps/role-fit-ai");
const workspaceDir = join(appRoot, "workspace");
const config = developmentViteConfig(appRoot, workspaceDir);
const ignored = config.server?.watch?.ignored;
assert.ok(Array.isArray(ignored) && ignored.length === 1 && typeof ignored[0] === "function", "the dev server sets one watch filter");
const isIgnored = ignored[0];
const at = (...segments) => join(appRoot, ...segments);
// chokidar hands Vite's filter forward-slash paths; native ones must agree.
const bothForms = (path) => [path, path.replaceAll("\\", "/")];

for (const watched of [
  appRoot,
  at("src"),
  at("src", "App.tsx"),
  at("shared", "fitAssessmentContract.ts"),
  at("index.html"),
  at("vite.config.ts"),
  at("package.json"),
  at("tsconfig.json"),
  at(".env"),
  at(".env.local"),
  resolve("C:/rolefit/packages/engine/src/lib/resumeFile.ts")
]) {
  for (const path of bothForms(watched)) assert.equal(isIgnored(path), false, `${path} stays watched`);
}

for (const unwatched of [
  workspaceDir,
  at("workspace", "applications", "a1", "resume.resume"),
  at("workspace.restore-backup-2026-10-23T16-46-19-744Z-cf3f4045", "applications.json"),
  at(".forge", "out", "RoleFit-win32-x64", "resources"),
  at("public", "fonts", "Carlito-Regular.ttf"),
  at("server", "runtime.ts"),
  at("desktop", "main.cts"),
  at("dist", "index.html"),
  at("docs", "releases", "0.24.0-beta.1.md"),
  at("node_modules", "vite", "package.json"),
  at("srcx", "file.ts"),
  at("tsconfig.server.json")
]) {
  for (const path of bothForms(unwatched)) assert.equal(isIgnored(path), true, `${path} is not watched`);
}

// Dot segments are resolved before the path is classified.
assert.equal(isIgnored(join(appRoot, "src", "..", "workspace")), true);

// The workspace also stays out of Vite's static and /@fs/ serving.
assert.ok(config.server.fs.strict);
assert.ok(config.server.fs.deny.some((pattern) => pattern.startsWith(workspaceDir.replaceAll("\\", "/").replace(/[\\^$.*+?()[\]{}|!@#,]/g, "\\$&"))));

console.log("vite watch scope probes passed");
