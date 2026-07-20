import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { resolveWindowsSquirrelPaths } from "../windows-installer-contract.mjs";

const appRoot = resolve(import.meta.dirname, "../..");
const packagedSmokePath = join(import.meta.dirname, "packaged-smoke.test.mjs");
const PROCESS_OUTPUT_LIMIT_BYTES = 32 * 1_024;
const INSTALL_TIMEOUT_MS = 120_000;
const INSTALL_PATH_TIMEOUT_MS = 60_000;
const UNINSTALL_TIMEOUT_MS = 120_000;

function fail(message) {
  throw new Error(`RoleFit Windows installer smoke: ${message}`);
}

function parseInstallerArgument(argv) {
  let installer = null;
  for (const argument of argv) {
    const match = /^--installer=(.+)$/.exec(argument);
    if (!match) fail(`unsupported argument ${argument}`);
    if (installer !== null) fail("duplicate --installer argument");
    installer = resolve(match[1]);
  }
  if (!installer) fail("--installer=<path> is required");
  return installer;
}

async function pathInfo(path) {
  return lstat(path).catch(() => null);
}

async function requireRegularFile(path, label) {
  const info = await pathInfo(path);
  if (!info?.isFile() || info.isSymbolicLink() || info.size <= 0) {
    fail(`${label} is not a non-empty regular file: ${path}`);
  }
}

async function waitForRegularFile(path, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await pathInfo(path);
    if (info?.isFile() && !info.isSymbolicLink() && info.size > 0) return;
    await delay(250);
  }
  fail(`timed out waiting for ${label}: ${path}`);
}

function runProcess(executable, args, label, timeoutMs, environment = process.env) {
  return new Promise((resolveRun, rejectRun) => {
    let child;
    try {
      child = spawn(executable, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: environment
      });
    } catch (error) {
      rejectRun(new Error(`${label} could not start: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }

    let output = "";
    let settled = false;
    let timedOut = false;
    let forceSettleTimer = null;
    const append = (chunk) => {
      output = (output + chunk.toString()).slice(-PROCESS_OUTPUT_LIMIT_BYTES);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill("SIGKILL");
      forceSettleTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        rejectRun(new Error(`${label} timed out after ${timeoutMs}ms and did not exit.`));
      }, 5_000);
    }, timeoutMs);

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceSettleTimer) clearTimeout(forceSettleTimer);
      rejectRun(new Error(`${label} failed to start: ${error.message}`));
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceSettleTimer) clearTimeout(forceSettleTimer);
      if (timedOut) {
        rejectRun(new Error(`${label} timed out after ${timeoutMs}ms.`));
        return;
      }
      if (code === 0) {
        resolveRun();
        return;
      }
      const detail = output.trim();
      rejectRun(new Error(
        `${label} exited with ${code ?? signal ?? "an unknown status"}.${detail ? `\n${detail}` : ""}`
      ));
    });
  });
}

async function uninstallInstalledApp(paths, environment) {
  if (!(await pathInfo(paths.installRoot))) return;

  let uninstallError = null;
  try {
    await requireRegularFile(paths.updater, "installed Squirrel updater");
    await runProcess(
      paths.updater,
      ["--uninstall", "--silent"],
      "Squirrel uninstall",
      UNINSTALL_TIMEOUT_MS,
      environment
    );
    await requireRegularFile(paths.tombstone, "Squirrel uninstall tombstone");
  } catch (error) {
    uninstallError = error;
  }

  if (await pathInfo(paths.installRoot)) {
    // Squirrel intentionally swallows immediate directory-deletion failures,
    // recreates or retains the package root, and writes a .dead tombstone.
    // Remove this exact isolated test install after Update.exe exits; failure
    // here still catches a RoleFit process that holds the installed payload.
    await rm(paths.installRoot, { recursive: true, force: true });
  }
  if (await pathInfo(paths.installRoot)) {
    throw new AggregateError(
      uninstallError ? [uninstallError] : [],
      `Squirrel install root remains after cleanup: ${paths.installRoot}`
    );
  }
  if (uninstallError) throw uninstallError;
}

async function main() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    fail(`installer smoke requires a native Windows x64 host; current host is ${process.platform}/${process.arch}`);
  }

  const installer = parseInstallerArgument(process.argv.slice(2));
  if (!isAbsolute(installer)) fail("installer path must resolve to an absolute path");
  await requireRegularFile(installer, "Squirrel installer");

  const packageJson = JSON.parse(await readFile(join(appRoot, "package.json"), "utf8"));
  const paths = resolveWindowsSquirrelPaths(process.env.LOCALAPPDATA, packageJson.version);
  if (await pathInfo(paths.installRoot)) {
    fail(`refusing to overwrite a pre-existing Squirrel install: ${paths.installRoot}`);
  }

  const tempRoot = await mkdtemp(join(tmpdir(), "rolefit-squirrel-smoke-"));
  const squirrelUserData = join(tempRoot, "user-data");
  await mkdir(squirrelUserData, { recursive: true });
  const squirrelEnvironment = {
    ...process.env,
    ROLEFIT_DESKTOP_USER_DATA: squirrelUserData
  };

  let primaryError = null;
  let cleanupError = null;
  let installationStarted = false;
  try {
    installationStarted = true;
    await runProcess(
      installer,
      ["--silent"],
      "Squirrel silent install",
      INSTALL_TIMEOUT_MS,
      squirrelEnvironment
    );
    await waitForRegularFile(paths.executable, "installed RoleFit executable", INSTALL_PATH_TIMEOUT_MS);
    await waitForRegularFile(paths.updater, "installed Squirrel updater", INSTALL_PATH_TIMEOUT_MS);
    await runProcess(
      process.execPath,
      [
        packagedSmokePath,
        "--platform=win32",
        "--arch=x64",
        `--executable=${paths.executable}`
      ],
      "installed RoleFit packaged smoke",
      90_000
    );
  } catch (error) {
    primaryError = error;
  } finally {
    if (installationStarted) {
      try {
        await uninstallInstalledApp(paths, squirrelEnvironment);
      } catch (error) {
        cleanupError = error;
      }
    }
    try {
      await rm(tempRoot, { recursive: true, force: true });
    } catch (error) {
      cleanupError = cleanupError
        ? new AggregateError([cleanupError, error], "Installed Windows cleanup failed.")
        : error;
    }
  }

  if (primaryError && cleanupError) {
    throw new AggregateError([primaryError, cleanupError], "Installed Windows smoke and cleanup both failed.");
  }
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;

  console.log(`desktop Windows installer smoke: passed (${packageJson.version}, install/run/uninstall)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
