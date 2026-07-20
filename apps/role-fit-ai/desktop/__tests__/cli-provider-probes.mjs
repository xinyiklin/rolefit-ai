import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  buildCliProcessEnvironment,
  createCliProviderManager,
  packagedCliSearchPaths,
  resolveCliProcessLaunch,
  resolveWindowsTreeKillLaunch,
  terminateCliProbeWithGrace
} from "../../dist-electron/desktop/cli-providers.cjs";

function completed(stdout = "", stderr = "", exitCode = 0) {
  return { kind: "completed", exitCode, stdout, stderr };
}

class FakeSignInProcess extends EventEmitter {
  kills = [];

  kill(signal = "SIGTERM") {
    this.kills.push(signal);
    return true;
  }
}

class FakeProbeProcess extends EventEmitter {
  kills = [];
  pid = 4321;

  kill(signal = "SIGTERM") {
    this.kills.push(signal);
    return true;
  }
}

assert.deepEqual(
  resolveCliProcessLaunch("darwin", "codex", ["login", "status"]),
  { executable: "codex", args: ["login", "status"] }
);
assert.deepEqual(
  resolveCliProcessLaunch(
    "win32",
    "codex",
    ["login", "status"],
    { SystemRoot: "C:\\Windows" }
  ),
  {
    executable: "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c", "codex login status"]
  },
  "Windows invokes fixed npm .cmd shims through the absolute system interpreter without renderer-authored text"
);
assert.throws(
  () => resolveCliProcessLaunch("win32", "codex", ["login&unexpected"]),
  /Unsupported CLI process command/
);
assert.deepEqual(
  resolveWindowsTreeKillLaunch(4321, { SystemRoot: "C:\\Windows" }),
  {
    executable: "C:\\Windows\\System32\\taskkill.exe",
    args: ["/pid", "4321", "/t", "/f"]
  },
  "Windows cleanup targets only the validated owned process tree"
);
assert.throws(() => resolveWindowsTreeKillLaunch(0, {}), /Invalid owned CLI process id/);

assert.deepEqual(
  buildCliProcessEnvironment({
    PATH: "/usr/bin",
    HOME: "/tmp/provider-home",
    CODEX_HOME: "/tmp/codex-home",
    CLAUDE_CONFIG_DIR: "/tmp/claude-home",
    TMPDIR: "/tmp/provider-temp",
    LANG: "en_US.UTF-8",
    HTTPS_PROXY: "http://proxy.invalid:8080",
    NODE_EXTRA_CA_CERTS: "/tmp/provider-ca.pem",
    ELECTRON_RUN_AS_NODE: "1",
    NODE_OPTIONS: "--require unexpected-module",
    NODE_PATH: "/tmp/injected-modules",
    OPENAI_API_KEY: "must-not-cross",
    openai_api_key: "must-not-cross-case-insensitively",
    OPENAI_ACCESS_TOKEN: "must-not-cross",
    ANTHROPIC_API_KEY: "must-not-cross",
    ANTHROPIC_AUTH_TOKEN: "must-not-cross",
    CODEX_ACCESS_TOKEN: "must-not-cross",
    CODEX_API_KEY: "must-not-cross",
    CLAUDE_CODE_OAUTH_TOKEN: "must-not-cross",
    GOOGLE_API_KEY: "must-not-cross",
    GEMINI_API_KEY: "must-not-cross",
    GOOGLE_APPLICATION_CREDENTIALS: "/tmp/must-not-cross.json",
    AWS_ACCESS_KEY_ID: "must-not-cross",
    AWS_SECRET_ACCESS_KEY: "must-not-cross",
    AZURE_CLIENT_SECRET: "must-not-cross",
    GITHUB_TOKEN: "must-not-cross",
    NPM_TOKEN: "must-not-cross",
    DATABASE_URL: "must-not-cross",
    ROLEFIT_PRIVATE_SECRET: "must-not-cross"
  }),
  {
    PATH: "/usr/bin",
    HOME: "/tmp/provider-home",
    CODEX_HOME: "/tmp/codex-home",
    CLAUDE_CONFIG_DIR: "/tmp/claude-home",
    TMPDIR: "/tmp/provider-temp",
    LANG: "en_US.UTF-8",
    HTTPS_PROXY: "http://proxy.invalid:8080",
    NODE_EXTRA_CA_CERTS: "/tmp/provider-ca.pem"
  },
  "only system, locale, temp, network trust, and provider session locations cross the CLI boundary"
);

assert.deepEqual(
  buildCliProcessEnvironment({
    Path: "C:\\RoleFit\\bin;C:\\Windows\\System32",
    UserProfile: "C:\\Users\\provider",
    AppData: "C:\\Users\\provider\\AppData\\Roaming",
    Github_Token: "must-not-cross"
  }, [], "win32"),
  {
    PATH: "C:\\RoleFit\\bin;C:\\Windows\\System32",
    USERPROFILE: "C:\\Users\\provider",
    APPDATA: "C:\\Users\\provider\\AppData\\Roaming"
  },
  "the Windows allowlist matches required names case-insensitively without admitting unrelated tokens"
);

const stubbornProbe = new FakeProbeProcess();
terminateCliProbeWithGrace(stubbornProbe, "darwin", {}, 5);
assert.deepEqual(stubbornProbe.kills, ["SIGTERM"]);
for (let attempt = 0; attempt < 100 && stubbornProbe.kills.length < 2; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
assert.deepEqual(
  stubbornProbe.kills,
  ["SIGTERM", "SIGKILL"],
  "a status probe that ignores SIGTERM is force-killed after the bounded grace"
);

const exitingProbe = new FakeProbeProcess();
terminateCliProbeWithGrace(exitingProbe, "darwin", {}, 5);
exitingProbe.emit("close", 0, null);
await new Promise((resolve) => setTimeout(resolve, 10));
assert.deepEqual(
  exitingProbe.kills,
  ["SIGTERM"],
  "a status probe that exits during the grace is not killed again"
);

assert.deepEqual(
  packagedCliSearchPaths("darwin", "/Users/provider", {}),
  [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/Users/provider/.local/bin",
    "/Users/provider/.npm-global/bin",
    "/Users/provider/.volta/bin",
    "/Users/provider/.asdf/shims",
    "/Users/provider/.bun/bin",
    "/usr/bin",
    "/bin"
  ]
);
assert.deepEqual(
  packagedCliSearchPaths("win32", "C:\\Users\\provider", {
    APPDATA: "C:\\Users\\provider\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\provider\\AppData\\Local"
  }),
  [
    "C:\\Users\\provider\\.local\\bin",
    "C:\\Users\\provider\\AppData\\Roaming\\npm",
    "C:\\Users\\provider\\AppData\\Local\\agy\\bin",
    "C:\\Users\\provider\\AppData\\Local\\Microsoft\\WinGet\\Links"
  ],
  "packaged Windows discovery covers fixed native, npm, Antigravity, and WinGet locations"
);
assert.deepEqual(
  buildCliProcessEnvironment(
    { PATH: "/usr/bin", HOME: "/Users/provider" },
    ["/opt/homebrew/bin", "/usr/bin", "relative/bin"]
  ),
  {
    PATH: "/opt/homebrew/bin:/usr/bin",
    HOME: "/Users/provider"
  },
  "packaged CLI discovery prepends only fixed absolute search paths"
);

const probeRequests = [];
const probeResponses = new Map([
  ["claude --version", completed("2.1.212 (Claude Code)\n")],
  ["claude auth status --json", completed('{"loggedIn":false,"email":"must-not-escape"}', "", 1)],
  ["codex --version", completed("codex-cli 0.144.5\n")],
  ["codex login status", completed("", "warning\nLogged in using ChatGPT\n")],
  ["agy --version", completed("1.1.4\n")]
]);
const spawned = [];
const terminalLaunches = [];
let nextOperation = 1;
const manager = createCliProviderManager({
  runProbe: async (request) => {
    probeRequests.push(request);
    return probeResponses.get(`${request.command} ${request.args.join(" ")}`) ??
      { kind: "failed", exitCode: null, stdout: "", stderr: "" };
  },
  spawnSignIn: (request) => {
    const child = new FakeSignInProcess();
    spawned.push({ request, child });
    return child;
  },
  launchTerminal: async (request) => {
    terminalLaunches.push(request);
  },
  processEnvironment: {
    PATH: "/usr/local/bin:/usr/bin",
    HOME: "/tmp/provider-home",
    CODEX_HOME: "/tmp/codex-home",
    CLAUDE_CONFIG_DIR: "/tmp/claude-home",
    ELECTRON_RUN_AS_NODE: "1",
    NODE_OPTIONS: "--require unexpected-module",
    OPENAI_API_KEY: "must-not-cross",
    OPENAI_ACCESS_TOKEN: "must-not-cross",
    ANTHROPIC_API_KEY: "must-not-cross",
    ANTHROPIC_AUTH_TOKEN: "must-not-cross",
    CODEX_ACCESS_TOKEN: "must-not-cross",
    CODEX_API_KEY: "must-not-cross",
    CLAUDE_CODE_OAUTH_TOKEN: "must-not-cross",
    GOOGLE_API_KEY: "must-not-cross",
    GEMINI_API_KEY: "must-not-cross",
    GOOGLE_APPLICATION_CREDENTIALS: "/tmp/must-not-cross.json",
    AWS_SECRET_ACCESS_KEY: "must-not-cross",
    GITHUB_TOKEN: "must-not-cross",
    DATABASE_URL: "must-not-cross"
  },
  createOperationId: () => `operation-${nextOperation++}`
});

const initial = await manager.getStatuses();
assert.deepEqual(initial, [
  {
    id: "claude-cli",
    label: "Claude Code",
    installed: true,
    authState: "signed-out",
    signInFlow: "managed",
    signInRunning: false,
    guidance: "Sign in to Claude Code to use this provider."
  },
  {
    id: "codex-cli",
    label: "Codex CLI",
    installed: true,
    authState: "signed-in",
    signInFlow: "managed",
    signInRunning: false,
    guidance: "Codex CLI is connected through its local CLI session."
  },
  {
    id: "antigravity-cli",
    label: "Antigravity CLI",
    installed: true,
    authState: "unknown",
    signInFlow: "manual",
    signInRunning: false,
    guidance: "Antigravity is installed. Its CLI does not expose a non-interactive sign-in check, so RoleFit verifies the session when first used."
  }
]);
assert(Object.isFrozen(initial));
assert(initial.every(Object.isFrozen));
assert(initial.every((status) => !Object.hasOwn(status, "version")));
assert(initial.every((status) => !Object.hasOwn(status, "stdout")));
assert.deepEqual(
  probeRequests.map(({ command, args, timeoutMs, outputLimitBytes }) => ({
    command,
    args: [...args],
    timeoutMs,
    outputLimitBytes
  })),
  [
    { command: "claude", args: ["--version"], timeoutMs: 5_000, outputLimitBytes: 16_384 },
    { command: "codex", args: ["--version"], timeoutMs: 5_000, outputLimitBytes: 16_384 },
    { command: "agy", args: ["--version"], timeoutMs: 5_000, outputLimitBytes: 16_384 },
    { command: "claude", args: ["auth", "status", "--json"], timeoutMs: 5_000, outputLimitBytes: 16_384 },
    { command: "codex", args: ["login", "status"], timeoutMs: 5_000, outputLimitBytes: 16_384 }
  ],
  "status checks use only the fixed, bounded provider commands; Antigravity has no fake auth probe"
);
for (const request of probeRequests) {
  assert.deepEqual(request.environment, {
    PATH: "/usr/local/bin:/usr/bin",
    HOME: "/tmp/provider-home",
    CODEX_HOME: "/tmp/codex-home",
    CLAUDE_CONFIG_DIR: "/tmp/claude-home"
  });
  assert.equal(Object.isFrozen(request.environment), true);
  assert.doesNotMatch(JSON.stringify(request.environment), /must-not-cross|unexpected-module/);
}

const claudeLogin = await manager.beginSignIn("claude-cli");
assert.deepEqual(claudeLogin, {
  status: "started",
  operationId: "operation-1",
  guidance: "Claude Code sign-in opened. Finish it in your browser."
});
assert.deepEqual(spawned[0].request, {
  command: "claude",
  args: ["auth", "login", "--claudeai"],
  environment: {
    PATH: "/usr/local/bin:/usr/bin",
    HOME: "/tmp/provider-home",
    CODEX_HOME: "/tmp/codex-home",
    CLAUDE_CONFIG_DIR: "/tmp/claude-home"
  }
});
assert.equal(Object.isFrozen(spawned[0].request.environment), true);
assert.doesNotMatch(JSON.stringify(spawned[0].request.environment), /must-not-cross|unexpected-module/);
assert.equal((await manager.getStatuses())[0].signInRunning, true);

const coalesced = await manager.beginSignIn("codex-cli");
assert.equal(coalesced.status, "already-running");
assert.equal(coalesced.operationId, claudeLogin.operationId);
assert.equal(spawned.length, 1, "a second sign-in cannot spawn while the first is active");
assert.equal(await manager.cancelSignIn("wrong-operation"), false);
assert.equal(await manager.cancelSignIn(claudeLogin.operationId), true);
assert.deepEqual(spawned[0].child.kills, ["SIGTERM"]);
spawned[0].child.emit("exit", 0, null);
assert.equal((await manager.getStatuses())[0].signInRunning, false);

const codexLogin = await manager.beginSignIn("codex-cli");
assert.equal(codexLogin.status, "started");
assert.deepEqual(spawned[1].request, {
  command: "codex",
  args: ["login"],
  environment: {
    PATH: "/usr/local/bin:/usr/bin",
    HOME: "/tmp/provider-home",
    CODEX_HOME: "/tmp/codex-home",
    CLAUDE_CONFIG_DIR: "/tmp/claude-home"
  }
});
spawned[1].child.emit("error", new Error("synthetic private diagnostic"));
assert.equal((await manager.getStatuses())[1].signInRunning, false, "process errors clean up the active operation");

const antigravityLogin = await manager.beginSignIn("antigravity-cli");
assert.deepEqual(antigravityLogin, {
  status: "manual",
  operationId: null,
  guidance: "Open a terminal and run `agy` to complete or confirm Google sign-in."
});
assert.equal(spawned.length, 2, "Antigravity never launches an unsupported hidden auth flow");

assert.deepEqual(await manager.openSignInInTerminal("claude-cli"), {
  status: "opened",
  guidance: "Claude Code sign-in opened in a terminal. Finish it there, then check again."
});
assert.deepEqual(await manager.openSignInInTerminal("codex-cli"), {
  status: "opened",
  guidance: "Codex CLI sign-in opened in a terminal. Finish it there, then check again."
});
assert.deepEqual(await manager.openSignInInTerminal("antigravity-cli"), {
  status: "opened",
  guidance: "Terminal opened. Run `agy` to complete or confirm Google sign-in, then check again."
});
assert.deepEqual(
  terminalLaunches.map(({ providerId, command, args }) => ({
    providerId,
    command,
    args: [...args]
  })),
  [
    {
      providerId: "claude-cli",
      command: "claude",
      args: ["auth", "login", "--claudeai"]
    },
    { providerId: "codex-cli", command: "codex", args: ["login"] },
    { providerId: "antigravity-cli", command: "agy", args: [] }
  ],
  "terminal launch accepts only the manager-owned provider command mapping"
);
for (const request of terminalLaunches) {
  assert.deepEqual(request.environment, {
    PATH: "/usr/local/bin:/usr/bin",
    HOME: "/tmp/provider-home",
    CODEX_HOME: "/tmp/codex-home",
    CLAUDE_CONFIG_DIR: "/tmp/claude-home"
  });
  assert.equal(Object.isFrozen(request.environment), true);
  assert.doesNotMatch(JSON.stringify(request.environment), /must-not-cross|unexpected-module/);
}
await assert.rejects(
  () => manager.openSignInInTerminal("shell"),
  /Unsupported CLI provider/
);

const failedTerminalManager = createCliProviderManager({
  runProbe: async () => completed("synthetic"),
  launchTerminal: async () => {
    throw new Error("private launcher diagnostic");
  }
});
let terminalError = null;
try {
  await failedTerminalManager.openSignInInTerminal("codex-cli");
} catch (error) {
  terminalError = error;
}
assert.ok(terminalError instanceof Error);
assert.equal(terminalError.message, "Could not open Codex CLI sign-in in a terminal.");
assert.doesNotMatch(terminalError.message, /private launcher diagnostic/);
await failedTerminalManager.shutdown();

const oversizedManager = createCliProviderManager({
  runProbe: async ({ command, args }) => {
    if (args[0] === "--version") return completed(`${command} 1.0.0`);
    return completed(`{"loggedIn":true,"private":"${"x".repeat(20_000)}"}`);
  }
});
const oversizedStatuses = await oversizedManager.getStatuses();
assert.equal(oversizedStatuses[0].authState, "unknown", "oversized status output fails closed");
assert.equal(oversizedStatuses[1].authState, "unknown", "unrecognized bounded output fails closed");
await oversizedManager.shutdown();

const missingManager = createCliProviderManager({
  runProbe: async () => ({ kind: "not-found", exitCode: null, stdout: "", stderr: "" })
});
const missingStatuses = await missingManager.getStatuses();
assert(missingStatuses.every((status) => status.installed === false));
assert(missingStatuses.every((status) => status.authState === "unknown"));
await missingManager.shutdown();

const lifetimeChildren = [];
const lifetimeManager = createCliProviderManager({
  runProbe: async () => completed("synthetic"),
  spawnSignIn: (request) => {
    const child = new FakeSignInProcess();
    lifetimeChildren.push({ request, child });
    return child;
  },
  createOperationId: () => "bounded-operation",
  signInMaxDurationMs: 5,
  signInTerminateGraceMs: 5
});
await lifetimeManager.beginSignIn("codex-cli");
// Wait on the observable kill sequence instead of assuming two nested timers
// always complete inside one fixed 20 ms window on a busy test runner.
for (let attempt = 0; attempt < 100 && lifetimeChildren[0].child.kills.length < 2; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
assert.deepEqual(
  lifetimeChildren[0].child.kills,
  ["SIGTERM", "SIGKILL"],
  "a sign-in that exceeds its maximum lifetime is terminated and then force-killed"
);
lifetimeChildren[0].child.emit("exit", null, "SIGKILL");
assert.equal((await lifetimeManager.getStatuses())[1].signInRunning, false);
await lifetimeManager.shutdown();

const shutdownLogin = await manager.beginSignIn("claude-cli");
const shutdownPromise = manager.shutdown();
assert.deepEqual(spawned[2].child.kills, ["SIGTERM"]);
spawned[2].child.emit("exit", 0, null);
await shutdownPromise;
await manager.shutdown();
assert.equal(await manager.cancelSignIn(shutdownLogin.operationId), false);
await assert.rejects(() => manager.getStatuses(), /shut down/);

console.log("desktop CLI provider manager probes: passed");
