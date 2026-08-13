import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const bundled = await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../useApplications.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
  plugins: [{
    name: "applications-harness",
    setup(build) {
      build.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "harness" }));
      build.onLoad({ filter: /.*/, namespace: "harness" }, () => ({
        loader: "js",
        contents: [
          "export const useCallback = (callback) => callback;",
          "export const useEffect = () => undefined;",
          "export const useRef = (initial) => globalThis.__applicationsHarness.useRef(initial);",
          "export const useState = (initial) => globalThis.__applicationsHarness.useState(initial);"
        ].join("\n")
      }));
    }
  }]
});

const { useApplications } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

function fixture(id) {
  const now = `2026-08-12T12:00:0${id.length}.000Z`;
  return {
    id,
    title: `Application ${id}`,
    jobUrl: `https://jobs.example.test/${id}`,
    status: "applied",
    createdAt: now,
    updatedAt: now
  };
}

const states = [];
const refs = [];
let stateCursor = 0;
let refCursor = 0;
globalThis.__applicationsHarness = {
  useState(initial) {
    const index = stateCursor++;
    if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
    return [states[index], (update) => {
      states[index] = typeof update === "function" ? update(states[index]) : update;
    }];
  },
  useRef(initial) {
    const index = refCursor++;
    if (!(index in refs)) refs[index] = { current: initial };
    return refs[index];
  }
};

function renderApplications() {
  stateCursor = 0;
  refCursor = 0;
  return useApplications();
}

const log = [];
const putGates = [];
const getGates = [];
let serverApplications = [];
let putCount = 0;
let getCount = 0;

function response(applications) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ applications, path: "/workspace/applications.json" })
  };
}

globalThis.fetch = async (url, init = {}) => {
  assert.equal(url, "/api/applications");
  if (init.method === "PUT") {
    const requestNumber = ++putCount;
    const payload = JSON.parse(init.body);
    const gate = putGates.shift();
    log.push(`PUT ${requestNumber} started`);
    if (gate) await gate.promise;
    for (const mutation of payload.mutations) {
      serverApplications = serverApplications.filter(({ id }) => id !== mutation.id);
      if (mutation.operation === "upsert") {
        serverApplications.unshift(payload.applications.find(({ id }) => id === mutation.id));
      }
    }
    log.push(`PUT ${requestNumber} finished`);
    return response(serverApplications.map((application) => ({ ...application })));
  }

  const requestNumber = ++getCount;
  const snapshot = serverApplications.map((application) => ({ ...application }));
  const gate = getGates.shift();
  log.push(`GET ${requestNumber} started`);
  if (gate) await gate.promise;
  log.push(`GET ${requestNumber} finished`);
  return response(snapshot);
};

const applications = renderApplications();

const firstPut = deferred();
const secondPut = deferred();
putGates.push(firstPut, secondPut);
const saveA = applications.createApplication(fixture("a"));
await waitFor(() => log.includes("PUT 1 started"), "the first queued write never started");
const firstRefresh = applications.refresh();
assert.equal(applications.refresh(), firstRefresh, "concurrent refresh callers share one refresh transaction");
const saveB = applications.createApplication(fixture("b"));
firstPut.resolve();
await waitFor(() => log.includes("PUT 2 started"), "the second queued write never started");
assert.equal(getCount, 0, "refresh started before a write appended to its original queue tail");
secondPut.resolve();
assert.deepEqual(await Promise.all([saveA, saveB, firstRefresh]), [true, true, true]);
assert.ok(
  log.indexOf("PUT 2 finished") < log.indexOf("GET 1 started"),
  "refresh must drain the stable write-queue tail before GET"
);

const blockedGet = deferred();
const thirdPut = deferred();
getGates.push(blockedGet);
const retryingRefresh = applications.refresh();
await waitFor(() => log.includes("GET 2 started"), "the refresh GET never started");
putGates.push(thirdPut);
const saveC = applications.createApplication(fixture("c"));
await waitFor(() => log.includes("PUT 3 started"), "the write racing GET never started");
let refreshSettled = false;
void retryingRefresh.then(() => { refreshSettled = true; });
blockedGet.resolve();
await waitFor(() => log.includes("GET 2 finished"), "the blocked refresh GET never settled");
await new Promise((resolve) => setImmediate(resolve));
assert.equal(refreshSettled, false, "a snapshot read before the racing write was incorrectly adopted");
thirdPut.resolve();
assert.deepEqual(await Promise.all([saveC, retryingRefresh]), [true, true]);
assert.ok(
  log.indexOf("PUT 3 finished") < log.indexOf("GET 3 started"),
  "refresh must retry after a write begins during GET"
);
assert.ok(applications.getApplication("c"), "the retried authoritative snapshot includes the racing write");
assert.equal(
  renderApplications().storagePath,
  "/workspace/applications.json",
  "an authoritative refresh retains the tracker storage path when it supersedes the mount read"
);

console.log("Applications refresh ordering passed");
