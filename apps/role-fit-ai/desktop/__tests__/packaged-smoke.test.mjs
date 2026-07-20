import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getCurrentFuseWire } from "@electron/fuses";

const appRoot = resolve(import.meta.dirname, "../..");

function option(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const platform = option("platform", process.platform);
const arch = option("arch", process.arch);
const explicitExecutable = option("executable", "");
if (!new Set(["darwin", "win32"]).has(platform)) {
  throw new Error("Packaged smoke supports only darwin and win32.");
}
if (!new Set(["arm64", "x64"]).has(arch)) {
  throw new Error("Packaged smoke supports only arm64 and x64.");
}
if (platform !== process.platform) {
  throw new Error("Packaged smoke must run on the same native platform as its package.");
}
if (explicitExecutable && platform !== "win32") {
  throw new Error("An explicit packaged-smoke executable is supported only for an installed Windows app.");
}
if (explicitExecutable && !isAbsolute(explicitExecutable)) {
  throw new Error("The explicit packaged-smoke executable must be an absolute path.");
}

const packageDirectory = join(
  appRoot,
  ".forge",
  "out",
  `RoleFit Local Companion-${platform}-${arch}`
);
const appBundle = platform === "darwin"
  ? join(packageDirectory, "RoleFit Local Companion.app")
  : packageDirectory;
const executable = explicitExecutable || (platform === "darwin"
  ? join(appBundle, "Contents", "MacOS", "RoleFitLocalCompanion")
  : join(packageDirectory, "RoleFitLocalCompanion.exe"));
const executableInfo = await lstat(executable);
assert(executableInfo.isFile() && !executableInfo.isSymbolicLink(),
  "Packaged smoke executable must be a regular file.");
if (platform === "darwin") {
  const signature = spawnSync(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", appBundle],
    { encoding: "utf8", timeout: 30_000 }
  );
  assert.equal(
    signature.status,
    0,
    `Packaged macOS signature is invalid.\n${signature.stderr || signature.stdout}`
  );
}
const fuseWire = await getCurrentFuseWire(executable);
assert.equal(fuseWire.version, "1");
assert.deepEqual(
  Array.from({ length: 9 }, (_, index) => String.fromCharCode(fuseWire[index])),
  ["0", "1", "0", "0", "1", "1", "0", "1", "1"],
  "packaged Electron security fuses must match the reviewed complete V1 wire"
);

async function pickPort() {
  const server = createServer();
  const port = await new Promise((resolvePort, rejectPort) => {
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") rejectPort(new Error("No smoke port."));
      else resolvePort(address.port);
    });
  });
  await new Promise((resolveClose, rejectClose) =>
    server.close((error) => error ? rejectClose(error) : resolveClose())
  );
  return port;
}

async function canBind(port) {
  return new Promise((resolveBind) => {
    const server = createServer();
    server.once("error", () => resolveBind(false));
    server.once("listening", () => server.close(() => resolveBind(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function waitForResponse(url, predicate, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "error", cache: "no-store" });
      const body = await response.text();
      if (predicate(response, body)) return { response, body };
    } catch {
      // The packaged utility process is still starting.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}.`);
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

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      rejectExit(new Error("Packaged companion did not exit in time."));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectExit(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    });
  });
}

const tempRoot = await mkdtemp(join(tmpdir(), "rolefit-packaged-smoke-"));
const userData = join(tempRoot, "user-data");
const foreignCwd = join(tempRoot, "foreign-cwd");
const fakeBin = join(tempRoot, "bin");
const pidFile = join(tempRoot, "server.pid");
await Promise.all([
  mkdir(userData, { recursive: true }),
  mkdir(foreignCwd, { recursive: true }),
  mkdir(fakeBin, { recursive: true })
]);

if (platform === "win32") {
  await writeFile(join(fakeBin, "agy.cmd"), "@echo off\r\necho agy 1.1.4\r\n", "utf8");
} else {
  const fakeAgy = join(fakeBin, "agy");
  await writeFile(fakeAgy, "#!/bin/sh\necho 'agy 1.1.4'\n", { mode: 0o755 });
}

const port = await pickPort();
const origin = `http://127.0.0.1:${port}`;
const childEnvironment = {
  ...process.env,
  PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
  ROLEFIT_DESKTOP_USER_DATA: userData,
  ROLEFIT_DESKTOP_PORT: String(port),
  ROLEFIT_DESKTOP_SMOKE: "companion",
  ROLEFIT_DESKTOP_SMOKE_HOLD_MS: "2500",
  ROLEFIT_DESKTOP_SMOKE_SERVER_PID_FILE: pidFile,
  ELECTRON_RUN_AS_NODE: "1"
};
delete childEnvironment.ROLEFIT_DESKTOP_MODE;
delete childEnvironment.ROLEFIT_WORKSPACE_DIR;

const child = spawn(executable, [], {
  cwd: foreignCwd,
  env: childEnvironment,
  stdio: ["ignore", "pipe", "pipe"]
});
let output = "";
const append = (chunk) => {
  output = (output + chunk.toString()).slice(-32_000);
};
child.stdout.on("data", append);
child.stderr.on("data", append);
const prematureExit = new Promise((_, rejectExit) => {
  child.once("exit", (code, signal) => {
    rejectExit(new Error(
      `Packaged companion exited before its local server was ready (${code ?? signal}).\n${output}`
    ));
  });
});

try {
  const health = await Promise.race([
    waitForResponse(
      `${origin}/api/health`,
      (response, body) => {
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return false;
        const payload = JSON.parse(body);
        return payload.service === "role-fit-ai" && payload.mode === "production";
      }
    ),
    prematureExit
  ]);
  assert.match(health.body, /"desktopCompatibilityVersion":1/);

  const page = await waitForResponse(
    `${origin}/`,
    (response, body) => response.ok && body.includes('<div id="root">')
  );
  const assetPath = page.body.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  assert(assetPath, "Packaged browser page must reference a hashed JavaScript asset.");
  await waitForResponse(`${origin}${assetPath}`, (response, body) => response.ok && body.length > 1_000);
  await waitForResponse(
    `${origin}/fonts/LMRoman10-Regular.woff2`,
    (response, body) => response.ok && response.headers.get("content-type") === "font/woff2" && body.length > 100
  );
  const workspace = await waitForResponse(
    `${origin}/api/workspace`,
    (response, body) => response.ok && body.includes("starter.resume")
  );
  assert.match(workspace.body, /"kind":"resume"/);

  const result = await waitForExit(child, 30_000);
  assert.equal(result.code, 0, `Packaged companion exited ${result.code ?? result.signal}.\n${output}`);
  assert.match(output, /ROLEFIT_DESKTOP_SMOKE_OK ownership=owned mode=production phase=companion/);
  assert.doesNotMatch(output, /Electron Security Warning/);

  await stat(join(userData, "workspace"));
  await stat(join(userData, "provider-vault", "providers.json"));
  const ownedPid = Number(await readFile(pidFile, "utf8"));
  assert(Number.isInteger(ownedPid) && ownedPid > 0);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && isPidAlive(ownedPid)) await delay(50);
  assert.equal(isPidAlive(ownedPid), false, `Packaged utility process ${ownedPid} is still alive.`);
  assert.equal(await canBind(port), true, "Packaged companion must release its loopback port.");
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await rm(tempRoot, { recursive: true, force: true });
}

console.log(
  `desktop packaged smoke: passed (${platform}-${arch}, ${explicitExecutable ? "installed" : "unpacked"})`
);
