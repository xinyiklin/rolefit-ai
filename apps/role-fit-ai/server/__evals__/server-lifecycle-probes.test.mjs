// Explicit listener-based probe. The offline eval auto-runner excludes
// `*.test.mjs` so its deterministic suites never need permission to bind ports.
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { request } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { computeWorkspaceFingerprint } from "../health-contract.ts";
import { startRoleFitServer } from "../runtime.ts";

const sourceAppRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoot = await mkdtemp(join(tmpdir(), "rolefit-server-runtime-"));
const appRoot = join(temporaryRoot, "app");
const workspaceDir = join(temporaryRoot, "workspace");
const indexMarker = "rolefit isolated runtime";
const envSentinelKey = "ROLEFIT_RUNTIME_LOCAL_ENV_SENTINEL";
const previousEnvSentinel = process.env[envSentinelKey];

function get(port, pathname, headers = {}) {
  return new Promise((resolveResponse, rejectResponse) => {
    const req = request({
      host: "127.0.0.1",
      port,
      path: pathname,
      method: "GET",
      headers
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolveResponse({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8")
        });
      });
    });
    req.on("error", rejectResponse);
    req.end();
  });
}

let runtime = null;
let restarted = null;
let launcher = null;
try {
  await mkdir(join(appRoot, "dist"), { recursive: true });
  await mkdir(join(appRoot, "server"), { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(
    join(appRoot, "dist", "index.html"),
    `<!doctype html><title>RoleFit test</title><main>${indexMarker}</main>`,
    "utf8"
  );
  await cp(
    join(sourceAppRoot, "server", "starter.resume"),
    join(workspaceDir, "base-resume.resume")
  );
  await cp(
    join(sourceAppRoot, "server", "starter.resume"),
    join(appRoot, "server", "starter.resume")
  );
  await writeFile(join(appRoot, "dist", "worker.mjs"), "export const ready = true;", "utf8");

  runtime = await startRoleFitServer({
    appRoot,
    workspaceDir,
    mode: "production",
    host: "127.0.0.1",
    port: 0,
    logger: null
  });

  assert.equal(runtime.host, "127.0.0.1");
  assert.equal(runtime.mode, "production");
  assert.ok(runtime.port > 0, "port:0 should resolve to the actual listener");
  assert.equal(runtime.origin, `http://127.0.0.1:${runtime.port}`);

  const page = await get(runtime.port, "/");
  assert.equal(page.status, 200);
  assert.match(page.body, new RegExp(indexMarker));
  assert.match(String(page.headers["content-security-policy"]), /default-src 'self'/);
  assert.match(String(page.headers["content-security-policy"]), /frame-ancestors 'none'/);
  assert.equal(page.headers["x-content-type-options"], "nosniff");
  assert.equal(page.headers["referrer-policy"], "no-referrer");

  const health = await get(runtime.port, "/api/health");
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.body), {
    service: "role-fit-ai",
    status: "ok",
    apiVersion: 1,
    desktopCompatibilityVersion: 2,
    mode: "production",
    workspaceFingerprint: computeWorkspaceFingerprint(workspaceDir)
  });

  const providers = await get(runtime.port, "/api/providers");
  assert.equal(providers.status, 200);
  assert.match(String(providers.headers["content-type"]), /application\/json/);
  assert.deepEqual(JSON.parse(providers.body), {
    schemaVersion: 1,
    companionManaged: false,
    providers: []
  });

  const applications = await get(runtime.port, "/api/applications");
  assert.equal(applications.status, 200);
  assert.deepEqual(JSON.parse(applications.body), {
    applications: [],
    path: "workspace/applications.json"
  });
  assert.doesNotMatch(
    applications.body,
    new RegExp(temporaryRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "the applications response must not disclose the host's absolute workspace path"
  );

  const providersPost = await new Promise((resolveResponse, rejectResponse) => {
    const req = request({
      host: "127.0.0.1",
      port: runtime.port,
      path: "/api/providers",
      method: "POST"
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolveResponse({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    req.on("error", rejectResponse);
    req.end();
  });
  assert.equal(providersPost.status, 405);
  assert.deepEqual(JSON.parse(providersPost.body), { error: "Use GET." });

  const worker = await get(runtime.port, "/worker.mjs");
  assert.equal(worker.status, 200);
  assert.match(String(worker.headers["content-type"]), /text\/javascript/);

  const workspace = await get(runtime.port, "/api/workspace");
  assert.equal(workspace.status, 200);
  const workspaceBody = JSON.parse(workspace.body);
  assert.equal(workspaceBody.path, workspaceDir);
  assert.equal(workspaceBody.baseResume.fileName, "base-resume.resume");
  await assert.rejects(readFile(join(appRoot, "job-search-workspace", "base-resume.resume")));

  const missingApi = await get(runtime.port, "/api/not-a-route");
  assert.equal(missingApi.status, 404);
  assert.match(String(missingApi.headers["content-type"]), /application\/json/);
  assert.deepEqual(JSON.parse(missingApi.body), { error: "API route not found." });

  for (const removedManagementRoute of ["/api/workspace/backup", "/api/workspace/restore"]) {
    const removed = await get(runtime.port, removedManagementRoute);
    assert.equal(removed.status, 404, `${removedManagementRoute} is not browser reachable`);
  }

  const foreignHost = await get(runtime.port, "/api/health", { Host: "attacker.example" });
  assert.equal(foreignHost.status, 403);
  assert.deepEqual(JSON.parse(foreignHost.body), { error: "Forbidden host." });

  const foreignOrigin = await get(runtime.port, "/api/health", {
    Host: `127.0.0.1:${runtime.port}`,
    Origin: "https://attacker.example"
  });
  assert.equal(foreignOrigin.status, 403);
  assert.deepEqual(JSON.parse(foreignOrigin.body), { error: "Cross-origin request blocked." });

  const releasedPort = runtime.port;
  await runtime.close();
  await runtime.close();
  runtime = null;
  await assert.rejects(get(releasedPort, "/api/health"));

  restarted = await startRoleFitServer({
    appRoot,
    workspaceDir,
    mode: "production",
    host: "127.0.0.1",
    port: releasedPort,
    logger: null
  });
  assert.equal(restarted.port, releasedPort, "close should release the listener for reuse");
  await restarted.close();
  restarted = null;

  await assert.rejects(
    startRoleFitServer({
      appRoot,
      workspaceDir,
      mode: "production",
      host: "127.0.0.1",
      port: releasedPort,
      logger: {
        info() {
          throw new Error("intentional logger failure");
        },
        warn() {}
      }
    }),
    /intentional logger failure/
  );
  restarted = await startRoleFitServer({
    appRoot,
    workspaceDir,
    mode: "production",
    host: "127.0.0.1",
    port: releasedPort,
    logger: null
  });
  assert.equal(restarted.port, releasedPort, "failed startup should release its listener");
  await restarted.close();
  restarted = null;

  await writeFile(
    join(appRoot, ".env"),
    `HOST=127.0.0.1\nPORT=${releasedPort}\nNODE_ENV=production\n`,
    "utf8"
  );
  const launcherEnv = { ...process.env };
  delete launcherEnv.HOST;
  delete launcherEnv.PORT;
  delete launcherEnv.NODE_ENV;
  launcherEnv.ROLEFIT_APP_ROOT = appRoot;
  launcherEnv.ROLEFIT_WORKSPACE_DIR = "relative-workspace";
  launcher = spawn(process.execPath, [join(sourceAppRoot, "server.ts")], {
    cwd: temporaryRoot,
    env: launcherEnv,
    stdio: ["ignore", "ignore", "ignore"]
  });
  const launcherDeadline = Date.now() + 10_000;
  while (Date.now() < launcherDeadline) {
    try {
      const launcherHealth = await get(releasedPort, "/api/health");
      if (launcherHealth.status === 200) break;
    } catch {
      await delay(50);
    }
  }
  const launcherHealth = await get(releasedPort, "/api/health");
  assert.equal(JSON.parse(launcherHealth.body).mode, "production");
  assert.equal(
    JSON.parse(launcherHealth.body).workspaceFingerprint,
    computeWorkspaceFingerprint(join(appRoot, "relative-workspace"))
  );
  const launcherWorkspace = await get(releasedPort, "/api/workspace");
  assert.equal(JSON.parse(launcherWorkspace.body).path, join(appRoot, "relative-workspace"));
  launcher.kill("SIGTERM");
  await once(launcher, "exit");
  launcher = null;
  await assert.rejects(get(releasedPort, "/api/health"));

  delete process.env[envSentinelKey];
  await writeFile(join(appRoot, ".env"), `${envSentinelKey}=must-not-load\n`, "utf8");
  restarted = await startRoleFitServer({
    appRoot,
    workspaceDir,
    mode: "production",
    host: "127.0.0.1",
    port: releasedPort,
    logger: null,
    loadLocalEnv: false
  });
  assert.equal(
    process.env[envSentinelKey],
    undefined,
    "an Electron-owned runtime can disable app-local .env loading"
  );
  await restarted.close();
  restarted = null;

  console.log("server lifecycle probes: passed");
} finally {
  if (launcher && launcher.exitCode === null) {
    launcher.kill("SIGTERM");
    await once(launcher, "exit").catch(() => {});
  }
  await runtime?.close();
  await restarted?.close();
  if (previousEnvSentinel === undefined) delete process.env[envSentinelKey];
  else process.env[envSentinelKey] = previousEnvSentinel;
  await rm(temporaryRoot, { recursive: true, force: true });
}
