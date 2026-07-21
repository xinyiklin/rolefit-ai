import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ROLEFIT_DESKTOP_COMPATIBILITY_VERSION,
  ROLEFIT_HEALTH_API_VERSION,
  computeWorkspaceFingerprint,
  createRoleFitHealthPayload,
  isCompatibleRoleFitHealth
} from "../../dist-electron/server/health-contract.js";
import {
  buildDesktopServerEnvironment
} from "../../dist-electron/desktop/server-process.cjs";
import {
  buildCliProcessEnvironment
} from "../../dist-electron/desktop/cli-providers.cjs";
import {
  resolveDesktopRuntimePaths
} from "../../dist-electron/desktop/runtime-paths.cjs";
import {
  readBoundedResponseText
} from "../../dist-electron/desktop/bounded-response.cjs";

assert.equal(
  await readBoundedResponseText(new Response("safe"), 4),
  "safe",
  "bounded response reads the exact supported body"
);
await assert.rejects(
  () => readBoundedResponseText(new Response("oversized-without-trusted-length"), 8),
  /response is too large/,
  "bounded response stops an oversized streamed body even without trusting Content-Length"
);
await assert.rejects(
  () => readBoundedResponseText(new Response("safe", { headers: { "Content-Length": "999" } }), 8),
  /response is too large/,
  "bounded response rejects an oversized declared length before reading"
);

const workspaceA = "/tmp/rolefit-contract-a";
const workspaceB = "/tmp/rolefit-contract-b";
const payload = createRoleFitHealthPayload("production", workspaceA);
const expected = {
  apiVersion: ROLEFIT_HEALTH_API_VERSION,
  desktopCompatibilityVersion: ROLEFIT_DESKTOP_COMPATIBILITY_VERSION,
  mode: "production",
  workspaceFingerprint: computeWorkspaceFingerprint(workspaceA)
};

assert.equal(isCompatibleRoleFitHealth(payload, expected), true);
assert.equal(
  isCompatibleRoleFitHealth(payload, { ...expected, mode: "development" }),
  false
);
assert.equal(
  isCompatibleRoleFitHealth(payload, {
    ...expected,
    workspaceFingerprint: computeWorkspaceFingerprint(workspaceB)
  }),
  false
);
assert.equal(
  isCompatibleRoleFitHealth({ ...payload, desktopCompatibilityVersion: 2 }, expected),
  false
);
assert.equal(isCompatibleRoleFitHealth({ service: "role-fit-ai" }, expected), false);
assert.notEqual(computeWorkspaceFingerprint(workspaceA), computeWorkspaceFingerprint(workspaceB));

const environment = buildDesktopServerEnvironment(
  {
    PATH: "/usr/bin",
    HOME: "/tmp/test-home",
    ALL_PROXY: "socks5://127.0.0.1:1080",
    all_proxy: "socks5://127.0.0.1:1081",
    OPENAI_API_KEY: "known-provider-secret",
    ANTHROPIC_API_KEY: "second-provider-secret",
    NODE_OPTIONS: "--require unexpected-module",
    ELECTRON_RUN_AS_NODE: "1",
    UNRELATED_CLOUD_TOKEN: "must-not-cross"
  },
  {
    NODE_ENV: "production",
    PATH: "/explicit/path",
    ROLEFIT_APP_ROOT: "/tmp/app",
    ANTHROPIC_API_KEY: "override-must-not-cross",
    NODE_OPTIONS: "--require override-must-not-cross"
  }
);
assert.equal(environment.PATH, "/explicit/path");
assert.equal(environment.HOME, "/tmp/test-home");
assert.equal(environment.ALL_PROXY, "socks5://127.0.0.1:1080");
assert.equal(environment.all_proxy, "socks5://127.0.0.1:1081");
assert.equal(environment.OPENAI_API_KEY, undefined);
assert.equal(environment.ANTHROPIC_API_KEY, undefined);
assert.equal(environment.NODE_ENV, "production");
assert.equal(environment.ROLEFIT_APP_ROOT, "/tmp/app");
assert.equal(environment.NODE_OPTIONS, undefined);
assert.equal(environment.ELECTRON_RUN_AS_NODE, undefined);
assert.equal(environment.UNRELATED_CLOUD_TOKEN, undefined);

const windowsEnvironment = buildDesktopServerEnvironment(
  {
    Path: "C:\\RoleFit\\bin;C:\\Windows\\System32",
    SystemRoot: "C:\\Windows",
    ComSpec: "C:\\User-Writable\\cmd.exe"
  },
  { NODE_ENV: "production" },
  "win32"
);
assert.equal(windowsEnvironment.PATH, "C:\\RoleFit\\bin;C:\\Windows\\System32");
assert.equal(windowsEnvironment.SYSTEMROOT, "C:\\Windows");
assert.equal(windowsEnvironment.COMSPEC, "C:\\Windows\\System32\\cmd.exe");
assert.equal(windowsEnvironment.Path, undefined);

const packagedGuiEnvironment = buildCliProcessEnvironment(
  { PATH: "/usr/bin", HOME: "/tmp/test-home" },
  ["/opt/homebrew/bin", "/usr/local/bin"]
);
const ownedServerEnvironment = buildDesktopServerEnvironment(
  {
    ...packagedGuiEnvironment,
    AI_PROVIDER: "codex-cli",
    EXTENSION_ALLOWED_ORIGINS: "chrome-extension://rolefit-test",
    AWS_SECRET_ACCESS_KEY: "must-not-cross"
  },
  { NODE_ENV: "production", ROLEFIT_APP_ROOT: "/tmp/app" }
);
assert.equal(
  ownedServerEnvironment.PATH,
  "/opt/homebrew/bin:/usr/local/bin:/usr/bin",
  "the owned server inherits the companion's fixed GUI CLI search path"
);
assert.equal(ownedServerEnvironment.AI_PROVIDER, "codex-cli");
assert.equal(
  ownedServerEnvironment.EXTENSION_ALLOWED_ORIGINS,
  "chrome-extension://rolefit-test",
  "server-only non-secret configuration survives the separate server allowlist"
);
assert.equal(ownedServerEnvironment.AWS_SECRET_ACCESS_KEY, undefined);

const mainSource = await readFile(new URL("../main.cts", import.meta.url), "utf8");
assert.match(
  mainSource,
  /const desktopServerSourceEnvironment:[\s\S]*\.\.\.process\.env[\s\S]*PATH: cliProcessEnvironment\.PATH/,
  "main augments the server source PATH without reusing the stricter CLI child environment"
);
assert.match(
  mainSource,
  /sourceEnvironment: desktopServerSourceEnvironment/,
  "the owned server receives its own allowlisted environment source"
);

const sourcePaths = resolveDesktopRuntimePaths({
  packaged: false,
  sourceAppRoot: "/tmp/rolefit-source",
  packagedAppRoot: "/tmp/RoleFit.app/Contents/Resources/app.asar",
  userDataDirectory: "/tmp/rolefit-user-data"
});
assert.deepEqual(sourcePaths, {
  appRoot: "/tmp/rolefit-source",
  serverEntry: "/tmp/rolefit-source/server.ts",
  serverCwd: "/tmp/rolefit-source",
  workspaceDir: "/tmp/rolefit-source/job-search-workspace"
});

const packagedPaths = resolveDesktopRuntimePaths({
  packaged: true,
  sourceAppRoot: "/tmp/rolefit-source",
  packagedAppRoot: "/tmp/RoleFit.app/Contents/Resources/app.asar",
  userDataDirectory: "/tmp/rolefit-user-data"
});
assert.deepEqual(packagedPaths, {
  appRoot: "/tmp/RoleFit.app/Contents/Resources/app.asar",
  serverEntry: "/tmp/RoleFit.app/Contents/Resources/app.asar/dist-electron/server/server.mjs",
  serverCwd: "/tmp/rolefit-user-data",
  workspaceDir: "/tmp/rolefit-user-data/workspace"
});
assert.throws(
  () => resolveDesktopRuntimePaths({
    packaged: true,
    sourceAppRoot: "/tmp/rolefit-source",
    packagedAppRoot: "/tmp/app.asar",
    userDataDirectory: "/tmp/rolefit-user-data",
    workspaceOverride: "relative-workspace"
  }),
  /ROLEFIT_WORKSPACE_DIR must be an absolute path/
);

console.log("desktop server contract probes: passed");
