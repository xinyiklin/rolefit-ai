import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import electronPath from "electron";
import {
  ROLEFIT_DESKTOP_COMPATIBILITY_VERSION,
  ROLEFIT_HEALTH_API_VERSION
} from "../../dist-electron/server/health-contract.js";

const appRoot = resolve(import.meta.dirname, "../..");
const candidatePorts = [5_182, 5_183];
const hmrPort = 24_678;
const activeChildren = new Set();
const activeServers = new Set();

async function canBind(port) {
  return new Promise((resolveBind) => {
    const server = createNetServer();
    server.once("error", () => resolveBind(false));
    server.once("listening", () => server.close(() => resolveBind(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function pickPort() {
  for (const port of candidatePorts) {
    if (await canBind(port)) return port;
  }
  throw new Error("RoleFit desktop smoke ports 5182-5183 are already occupied.");
}

async function waitForHealth(origin, mode, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health`, {
        headers: { Accept: "application/json" },
        redirect: "error"
      });
      const data = await response.json();
      if (
        response.ok &&
        response.headers.get("content-type")?.includes("application/json") &&
        data.service === "role-fit-ai" &&
        data.apiVersion === ROLEFIT_HEALTH_API_VERSION &&
        data.desktopCompatibilityVersion === ROLEFIT_DESKTOP_COMPATIBILITY_VERSION &&
        data.mode === mode &&
        typeof data.workspaceFingerprint === "string"
      ) {
        return;
      }
    } catch {
      // The listener is not ready yet.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for the ${mode} RoleFit smoke server.`);
}

function spawnCaptured(command, args, env) {
  const child = spawn(command, args, {
    cwd: appRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  activeChildren.add(child);
  let output = "";
  const append = (chunk) => {
    output = (output + chunk.toString()).slice(-24_000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.once("exit", () => activeChildren.delete(child));
  return { child, output: () => output };
}

function waitForExit(handle, timeoutMs) {
  const { child } = handle;
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolveExit, rejectExit) => {
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onError = (error) => {
      cleanup();
      rejectExit(error);
    };
    const onExit = (code, signal) => {
      cleanup();
      resolveExit({ code, signal });
    };
    const timeout = setTimeout(() => {
      cleanup();
      rejectExit(new Error("process-exit-timeout"));
    }, timeoutMs);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function terminateCaptured(handle, label) {
  const { child } = handle;
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  try {
    await waitForExit(handle, 5_000);
    return;
  } catch (error) {
    if (error.message !== "process-exit-timeout") throw error;
  }
  child.kill("SIGKILL");
  try {
    await waitForExit(handle, 2_000);
  } catch (error) {
    throw new Error(`${label} did not stop after SIGKILL.\n${handle.output()}`, { cause: error });
  }
}

async function waitForOutput(handle, marker, timeoutMs = 35_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (handle.output().includes(marker)) return;
    if (handle.child.exitCode !== null || handle.child.signalCode !== null) {
      throw new Error(
        `Process exited before emitting ${marker}.\n${handle.output()}`
      );
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${marker}.\n${handle.output()}`);
}

async function collectProcess(handle, label, timeoutMs = 35_000) {
  try {
    const result = await waitForExit(handle, timeoutMs);
    return { ...result, output: handle.output() };
  } catch (error) {
    await terminateCaptured(handle, label);
    throw new Error(`${label} timed out or failed to launch.\n${handle.output()}`, { cause: error });
  }
}

async function runProcess(command, args, env, label, timeoutMs = 35_000) {
  return collectProcess(spawnCaptured(command, args, env), label, timeoutMs);
}

function assertElectronSuccess(result, marker) {
  assert.equal(result.code, 0, `Electron exited ${result.code ?? result.signal}.\n${result.output}`);
  assert.match(result.output, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(result.output, /Electron Security Warning/);
}

function assertElectronFailure(result, expectedMessage) {
  assert.equal(result.code, 1, `Electron should fail closed.\n${result.output}`);
  assert.match(result.output, expectedMessage);
  assert.doesNotMatch(result.output, /ROLEFIT_DESKTOP_SMOKE_OK/);
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

function signalPid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function assertOwnedPidGone(pidFile, label) {
  const rawPid = await readFile(pidFile, "utf8");
  const pid = Number(rawPid);
  assert.equal(Number.isInteger(pid) && pid > 0, true, `${label} must record a valid owned PID.`);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && isPidAlive(pid)) await delay(50);
  assert.equal(isPidAlive(pid), false, `${label} utility process ${pid} is still alive.`);
}

async function cleanupOwnedPidFile(pidFile) {
  let pid;
  try {
    pid = Number(await readFile(pidFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (!Number.isInteger(pid) || pid <= 0 || !isPidAlive(pid)) return;
  if (!signalPid(pid, "SIGTERM")) return;
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline && isPidAlive(pid)) await delay(50);
  if (isPidAlive(pid)) signalPid(pid, "SIGKILL");
  const killDeadline = Date.now() + 2_000;
  while (Date.now() < killDeadline && isPidAlive(pid)) await delay(50);
  assert.equal(isPidAlive(pid), false, `Test-owned utility process ${pid} survived cleanup.`);
}

async function stopChild(handle, label) {
  await terminateCaptured(handle, label);
}

async function listenHttp(server, port) {
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", rejectListen);
      activeServers.add(server);
      resolveListen();
    });
  });
}

async function closeHttp(server) {
  if (!server.listening) {
    activeServers.delete(server);
    return;
  }
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
  activeServers.delete(server);
}

function electronEnv(baseEnv, overrides = {}) {
  const env = { ...baseEnv, ...overrides };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

const tempRoot = await mkdtemp(join(tmpdir(), "rolefit-electron-smoke-"));
const workspaceDir = join(tempRoot, "workspace");
const mismatchedWorkspaceDir = join(tempRoot, "mismatched-workspace");
await mkdir(workspaceDir, { recursive: true });
const port = await pickPort();
const origin = `http://127.0.0.1:${port}`;
const baseEnv = electronEnv(process.env, {
  ROLEFIT_DESKTOP_SMOKE: "companion",
  ROLEFIT_DESKTOP_PORT: String(port),
  ROLEFIT_DESKTOP_MODE: "production",
  ROLEFIT_WORKSPACE_DIR: workspaceDir
});
const ownedProductionPidFile = join(tempRoot, "owned-production.pid");
const ownedDevelopmentPidFile = join(tempRoot, "owned-development.pid");

try {
  const singleInstanceEnv = electronEnv(baseEnv, {
    ROLEFIT_DESKTOP_USER_DATA: join(tempRoot, "single-instance-user-data"),
    // Keep one owned instance alive long enough to prove main refreshes the
    // provider snapshot even when no renderer IPC request drives it.
    ROLEFIT_DESKTOP_SMOKE_HOLD_MS: "6500",
    ROLEFIT_DESKTOP_SMOKE_SERVER_PID_FILE: ownedProductionPidFile
  });
  const firstInstance = spawnCaptured(electronPath, [appRoot], singleInstanceEnv);
  await waitForOutput(
    firstInstance,
    "ROLEFIT_DESKTOP_SMOKE_READY ownership=owned mode=production phase=companion"
  );

  const secondInstance = await runProcess(
    electronPath,
    [appRoot],
    singleInstanceEnv,
    "second Electron instance",
    15_000
  );
  assert.equal(secondInstance.code, 0, `Second instance did not exit cleanly.\n${secondInstance.output}`);
  assert.doesNotMatch(secondInstance.output, /ROLEFIT_DESKTOP_SMOKE_READY|ROLEFIT_DESKTOP_SMOKE_OK/);
  await waitForOutput(firstInstance, "ROLEFIT_DESKTOP_SECOND_INSTANCE_FOCUSED", 10_000);
  const ownedProduction = await collectProcess(firstInstance, "owned production Electron", 15_000);
  assertElectronSuccess(
    ownedProduction,
    "ROLEFIT_DESKTOP_SMOKE_OK ownership=owned mode=production phase=companion"
  );
  await assertOwnedPidGone(ownedProductionPidFile, "owned production server");
  assert.equal(await canBind(port), true, "owned production server should release its port");

  const reusableProduction = spawnCaptured(process.execPath, [join(appRoot, "server.ts")], {
    ...process.env,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    ROLEFIT_APP_ROOT: appRoot,
    ROLEFIT_WORKSPACE_DIR: workspaceDir
  });
  await waitForHealth(origin, "production");
  const reusedProduction = await runProcess(
    electronPath,
    [appRoot],
    electronEnv(baseEnv, {
      ROLEFIT_DESKTOP_USER_DATA: join(tempRoot, "reused-production-user-data")
    }),
    "reused production Electron"
  );
  assertElectronSuccess(
    reusedProduction,
    "ROLEFIT_DESKTOP_SMOKE_OK ownership=reused mode=production phase=companion"
  );
  await waitForHealth(origin, "production", 2_000);
  assert.equal(reusableProduction.child.exitCode, null, "Electron must not stop a reused server");

  const workspaceMismatch = await runProcess(
    electronPath,
    [appRoot],
    electronEnv(baseEnv, {
      ROLEFIT_WORKSPACE_DIR: mismatchedWorkspaceDir,
      ROLEFIT_DESKTOP_USER_DATA: join(tempRoot, "workspace-mismatch-user-data")
    }),
    "workspace mismatch Electron"
  );
  assertElectronFailure(workspaceMismatch, /not a compatible RoleFit server/);

  const modeMismatch = await runProcess(
    electronPath,
    [appRoot],
    electronEnv(baseEnv, {
      ROLEFIT_DESKTOP_MODE: "development",
      ROLEFIT_DESKTOP_USER_DATA: join(tempRoot, "mode-mismatch-user-data")
    }),
    "mode mismatch Electron"
  );
  assertElectronFailure(modeMismatch, /not a compatible RoleFit server/);
  await waitForHealth(origin, "production", 2_000);
  await stopChild(reusableProduction, "reusable production server");
  assert.equal(await canBind(port), true, "reusable production cleanup should release its port");

  const reusableDevelopment = spawnCaptured(process.execPath, [join(appRoot, "server.ts")], {
    ...process.env,
    NODE_ENV: "development",
    HOST: "127.0.0.1",
    PORT: String(port),
    ROLEFIT_APP_ROOT: appRoot,
    ROLEFIT_WORKSPACE_DIR: workspaceDir
  });
  await waitForHealth(origin, "development");
  const reusedDevelopment = await runProcess(
    electronPath,
    [appRoot],
    electronEnv(baseEnv, {
      ROLEFIT_DESKTOP_MODE: "development",
      ROLEFIT_DESKTOP_USER_DATA: join(tempRoot, "reused-development-user-data")
    }),
    "reused development Electron"
  );
  assertElectronSuccess(
    reusedDevelopment,
    "ROLEFIT_DESKTOP_SMOKE_OK ownership=reused mode=development phase=companion"
  );
  await waitForHealth(origin, "development", 2_000);
  assert.equal(reusableDevelopment.child.exitCode, null, "Electron must not stop reused Vite");
  await stopChild(reusableDevelopment, "reusable development server");
  assert.equal(await canBind(port), true, "reusable development cleanup should release its port");
  assert.equal(await canBind(hmrPort), true, "reusable Vite HMR should release its socket");

  const ownedDevelopment = await runProcess(
    electronPath,
    [appRoot],
    electronEnv(baseEnv, {
      ROLEFIT_DESKTOP_MODE: "development",
      ROLEFIT_DESKTOP_USER_DATA: join(tempRoot, "owned-development-user-data"),
      ROLEFIT_DESKTOP_SMOKE_SERVER_PID_FILE: ownedDevelopmentPidFile
    }),
    "owned development Electron"
  );
  assertElectronSuccess(
    ownedDevelopment,
    "ROLEFIT_DESKTOP_SMOKE_OK ownership=owned mode=development phase=companion"
  );
  await assertOwnedPidGone(ownedDevelopmentPidFile, "owned development server");
  assert.equal(await canBind(port), true, "owned development server should release its port");
  assert.equal(await canBind(hmrPort), true, "owned Vite HMR should release its socket");

  const incompatibleServer = createHttpServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("not RoleFit");
  });
  await listenHttp(incompatibleServer, port);
  const incompatiblePort = await runProcess(
    electronPath,
    [appRoot],
    electronEnv(baseEnv, {
      ROLEFIT_DESKTOP_USER_DATA: join(tempRoot, "incompatible-port-user-data")
    }),
    "incompatible port Electron"
  );
  assertElectronFailure(incompatiblePort, /not a compatible RoleFit server/);
  assert.equal(incompatibleServer.listening, true, "Electron must not stop an arbitrary listener");
  await closeHttp(incompatibleServer);
} finally {
  for (const child of [...activeChildren]) {
    await terminateCaptured({ child, output: () => "cleanup" }, "desktop smoke cleanup");
  }
  for (const server of [...activeServers]) await closeHttp(server);
  await cleanupOwnedPidFile(ownedProductionPidFile);
  await cleanupOwnedPidFile(ownedDevelopmentPidFile);
  await rm(tempRoot, { recursive: true, force: true });
}

assert.equal(await canBind(port), true, "desktop smoke must release its HTTP port");
assert.equal(await canBind(hmrPort), true, "desktop smoke must release Vite HMR");
console.log(
  "desktop Electron smoke: typed bridge + single-instance + owned/reused production/development + mismatch rejection passed"
);
