import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  ROLEFIT_DESKTOP_COMPATIBILITY_VERSION,
  ROLEFIT_HEALTH_API_VERSION,
  computeWorkspaceFingerprint,
  createRoleFitHealthPayload,
  isCompatibleRoleFitHealth
} from "../../dist-electron/server/health-contract.js";
import {
  buildDesktopServerEnvironment,
  probeCompatibleDesktopServer,
  probeDesktopServerLaunchKind
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
import {
  findLoopbackListenerPid,
  parseLsofListenerPid,
  parseNetstatListenerPid
} from "../../dist-electron/desktop/listener-process.cjs";

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

assert.equal(parseLsofListenerPid("4217\n"), 4_217);
assert.equal(parseLsofListenerPid("4217\n4217\n"), 4_217);
assert.equal(
  parseLsofListenerPid("4217\n9182\n"),
  null,
  "an ambiguous POSIX listener lookup cannot authorize takeover"
);

const netstatOutput = [
  "  Proto  Local Address          Foreign Address        State           PID",
  "  TCP    127.0.0.1:5181        0.0.0.0:0              LISTENING       7312",
  "  TCP    127.0.0.1:5181        127.0.0.1:60122        ESTABLISHED     7312",
  "  TCP    127.0.0.1:5191        0.0.0.0:0              LISTENING       8122"
].join("\r\n");
assert.equal(parseNetstatListenerPid(netstatOutput, 5_181), 7_312);
assert.equal(parseNetstatListenerPid(netstatOutput, 5_191), 8_122);

const lookupCalls = [];
assert.equal(
  await findLoopbackListenerPid(5_181, {
    platform: "darwin",
    runCommand: async (executable, args) => {
      lookupCalls.push([executable, args]);
      return "4217\n";
    }
  }),
  4_217
);
assert.deepEqual(lookupCalls, [[
  "/usr/sbin/lsof",
  ["-nP", "-iTCP@127.0.0.1:5181", "-sTCP:LISTEN", "-t"]
]]);
assert.equal(
  await findLoopbackListenerPid(5_181, {
    platform: "win32",
    runCommand: async (executable, args) => {
      assert.equal(executable, "C:\\Windows\\System32\\netstat.exe");
      assert.deepEqual(args, ["-ano", "-p", "tcp"]);
      return netstatOutput;
    }
  }),
  7_312
);
assert.equal(
  await findLoopbackListenerPid(5_181, {
    platform: "linux",
    runCommand: async () => {
      throw new Error("lookup unavailable");
    }
  }),
  null,
  "a missing platform lookup tool fails closed"
);

const workspaceA = "/tmp/rolefit-contract-a";
const workspaceB = "/tmp/rolefit-contract-b";
const payload = createRoleFitHealthPayload("production", workspaceA, "companion");
const expected = {
  apiVersion: ROLEFIT_HEALTH_API_VERSION,
  desktopCompatibilityVersion: ROLEFIT_DESKTOP_COMPATIBILITY_VERSION,
  mode: "production",
  workspaceFingerprint: computeWorkspaceFingerprint(workspaceA)
};

assert.equal(isCompatibleRoleFitHealth(payload, expected), true);
assert.equal(payload.launchKind, "companion");
assert.equal(
  createRoleFitHealthPayload("production", workspaceA, "standalone").launchKind,
  "standalone"
);
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
  isCompatibleRoleFitHealth({
    ...payload,
    desktopCompatibilityVersion: ROLEFIT_DESKTOP_COMPATIBILITY_VERSION + 1
  }, expected),
  false
);
assert.equal(isCompatibleRoleFitHealth({ ...payload, launchKind: "unknown" }, expected), false);
const { launchKind: _launchKind, ...payloadWithoutLaunchKind } = payload;
assert.equal(isCompatibleRoleFitHealth(payloadWithoutLaunchKind, expected), false);
assert.equal(isCompatibleRoleFitHealth({ service: "role-fit-ai" }, expected), false);
assert.notEqual(computeWorkspaceFingerprint(workspaceA), computeWorkspaceFingerprint(workspaceB));

const healthServer = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
});
await new Promise((resolveListen, rejectListen) => {
  healthServer.once("error", rejectListen);
  healthServer.listen(0, "127.0.0.1", resolveListen);
});
const healthAddress = healthServer.address();
assert.equal(typeof healthAddress, "object");
assert.notEqual(healthAddress, null);
try {
  const identity = {
    host: "127.0.0.1",
    mode: "production",
    port: healthAddress.port,
    workspaceDir: workspaceA
  };
  assert.equal(await probeCompatibleDesktopServer(identity), true);
  assert.equal(await probeDesktopServerLaunchKind(identity), "companion");
  assert.equal(
    await probeCompatibleDesktopServer({ ...identity, workspaceDir: workspaceB }),
    false,
    "takeover identity rejects a listener bound to a different workspace"
  );
  assert.equal(
    await probeDesktopServerLaunchKind({ ...identity, workspaceDir: workspaceB }),
    null,
    "live status rejects a replacement listener with a mismatched identity"
  );
} finally {
  await new Promise((resolveClose, rejectClose) => {
    healthServer.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

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
  ["/opt/homebrew/bin", "/usr/local/bin"],
  "darwin"
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
const listenerSource = await readFile(new URL("../listener-process.cts", import.meta.url), "utf8");
const serverSource = await readFile(new URL("../../server.ts", import.meta.url), "utf8");
const runtimeSource = await readFile(new URL("../../server/runtime.ts", import.meta.url), "utf8");
assert.doesNotMatch(
  runtimeSource,
  /\/api\/workspace\/(?:backup|restore)/,
  "workspace transfer is not exposed through the browser-reachable HTTP router"
);
assert.match(
  serverSource,
  /rolefit-workspace-request[\s\S]*createWorkspaceBackup[\s\S]*restoreWorkspaceBackup[\s\S]*rolefit-workspace-response/,
  "the companion-owned utility channel carries backup and restore requests"
);
assert.match(
  serverSource,
  /launchKind: companionOwned \? "companion" : "standalone"/,
  "the server reports whether Electron launched it through a utility parent"
);
assert.match(
  serverSource,
  /function handleSignal\(\)[\s\S]*shutdown\(\)\.finally[\s\S]*process\.exit\(\)/,
  "a graceful signal closes the server before exiting a utility kept alive by its parent port"
);
assert.match(
  mainSource,
  /server\.backupWorkspace\(\)[\s\S]*server\.restoreWorkspace\(body\)/,
  "desktop main uses the private child-process methods instead of loopback management routes"
);
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
assert.ok(
  mainSource.indexOf("desktopServer = await resolveDesktopServer") <
    mainSource.indexOf("const extensionDirectory = await materializeRoleFitExtension"),
  "the companion resolves the active server before generating the extension config"
);
assert.match(
  mainSource,
  /materializeRoleFitExtension\(\{[\s\S]*localSitePort: localSiteSettings\.localSitePort/,
  "the materialized extension receives the resolved local-site port"
);
assert.match(
  mainSource,
  /desktopServer\?\.ownership !== "owned"[\s\S]*return extensionPairingSettings/,
  "a reused server cannot expose actionable extension pairing requests"
);
assert.match(
  mainSource,
  /onUnexpectedExit: \(code\)[\s\S]*code === 0[\s\S]*shutdownAndExit\(0\)[\s\S]*stopped unexpectedly/,
  "a previous companion exits cleanly after another companion gracefully restarts its service"
);
assert.match(
  mainSource,
  /process\.kill\(listenerPid, "SIGTERM"\)/,
  "a recognized POSIX RoleFit listener receives only a graceful takeover signal"
);
assert.doesNotMatch(
  listenerSource,
  /SIGKILL|taskkill|\/F/,
  "listener takeover never escalates to a forced process kill"
);

const sourceAppRoot = resolve("/tmp/rolefit-source");
const packagedAppRoot = resolve("/tmp/RoleFit.app/Contents/Resources/app.asar");
const userDataDirectory = resolve("/tmp/rolefit-user-data");

const sourcePaths = resolveDesktopRuntimePaths({
  packaged: false,
  sourceAppRoot,
  packagedAppRoot,
  userDataDirectory
});
assert.deepEqual(sourcePaths, {
  appRoot: sourceAppRoot,
  serverEntry: join(sourceAppRoot, "server.ts"),
  serverCwd: sourceAppRoot,
  workspaceDir: join(sourceAppRoot, "workspace")
});

const packagedPaths = resolveDesktopRuntimePaths({
  packaged: true,
  sourceAppRoot,
  packagedAppRoot,
  userDataDirectory
});
assert.deepEqual(packagedPaths, {
  appRoot: packagedAppRoot,
  serverEntry: join(packagedAppRoot, "dist-electron", "server", "server.mjs"),
  serverCwd: userDataDirectory,
  workspaceDir: join(userDataDirectory, "workspace")
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
