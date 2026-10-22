// useAutoGhosting drives the automatic pass: it waits for a loaded, idle,
// error-free tracker and a settled valid threshold, runs under the same-origin
// tab lock, re-reads first, counts what it marked, and never retries an id.
// Driven with a minimal effect-running React stand-in and fake timers.

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { planGhostedMarks } from "../../lib/ghostedMarks.ts";
import { toIso } from "../../lib/dateInput.ts";

const bundled = await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../useAutoGhosting.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
  plugins: [{
    name: "auto-ghosting-harness",
    setup(build) {
      build.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "harness" }));
      build.onLoad({ filter: /.*/, namespace: "harness" }, () => ({
        loader: "js",
        contents: [
          "export const useCallback = (callback) => callback;",
          "export const useEffect = (effect, deps) => globalThis.__autoGhostingHarness.useEffect(effect, deps);",
          "export const useRef = (initial) => globalThis.__autoGhostingHarness.useRef(initial);",
          "export const useState = (initial) => globalThis.__autoGhostingHarness.useState(initial);"
        ].join("\n")
      }));
    }
  }]
});
const { useAutoGhosting } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

// --- React stand-in: state, refs, and effects that rerun on changed deps -----
const states = [];
const refs = [];
const effects = [];
let cursors = { state: 0, ref: 0, effect: 0 };
let queued = [];
globalThis.__autoGhostingHarness = {
  useState(initial) {
    const index = cursors.state++;
    if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
    return [states[index], (update) => {
      states[index] = typeof update === "function" ? update(states[index]) : update;
    }];
  },
  useRef(initial) {
    const index = cursors.ref++;
    if (!(index in refs)) refs[index] = { current: initial };
    return refs[index];
  },
  useEffect(effect, deps) {
    const index = cursors.effect++;
    const previous = effects[index];
    if (!previous || deps.some((dep, at) => !Object.is(dep, previous.deps[at]))) {
      queued.push({ index, effect, deps });
    }
  }
};

// --- Fake timers --------------------------------------------------------------
let now = 0;
let timers = [];
let nextTimer = 1;
globalThis.setTimeout = (callback, ms) => {
  const id = nextTimer++;
  timers.push({ id, at: now + ms, callback });
  return id;
};
globalThis.clearTimeout = (id) => {
  timers = timers.filter((timer) => timer.id !== id);
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
async function advance(ms) {
  now += ms;
  for (const timer of timers.filter((entry) => entry.at <= now)) {
    timers = timers.filter((entry) => entry.id !== timer.id);
    timer.callback();
  }
  for (let i = 0; i < 10; i += 1) await flush();
}

// --- Same-origin tab lock -----------------------------------------------------
const lockRequests = [];
let lockTail = Promise.resolve();
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    locks: {
      request(name, callback) {
        lockRequests.push(name);
        const run = lockTail.then(() => callback({ name }));
        lockTail = run.catch(() => undefined);
        return run;
      }
    }
  }
});

// --- The settings cache every tab shares (follows this tab unless overridden) ---
const store = new Map();
let cacheOverride = null;
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
const syncCache = () => store.set("rolefit:settings", JSON.stringify(
  cacheOverride ?? { autoMarkGhosted: options.enabled, ghostedAfterDays: options.afterDays }
));

// --- A tracker shared by "tabs": refresh copies the server; writes conflict ---
const nextRevision = (previous) => new Date(Date.parse(previous) + 1).toISOString();
let server = [];
let local = [];
const calls = [];
let failWrites = false;
const tracker = {
  refresh: async () => {
    calls.push("refresh");
    local = structuredClone(server);
    return true;
  },
  getApplication: (id) => local.find((application) => application.id === id),
  markGhosted: async (marks) => {
    calls.push(["mark", marks]);
    const plan = planGhostedMarks(local, marks, nextRevision);
    if (plan.kind !== "ready" || failWrites) return null;
    const conflict = plan.mutations.some((mutation) => server.find(({ id }) => id === mutation.id)?.updatedAt !== mutation.baseUpdatedAt);
    if (conflict) return null;
    server = structuredClone(plan.next);
    local = plan.next;
    return plan.mutations.length;
  }
};

let options = {};
let result;
function render(next = {}) {
  options = { ...options, ...next };
  syncCache();
  cursors = { state: 0, ref: 0, effect: 0 };
  queued = [];
  result = useAutoGhosting({ ...tracker, applications: local, ...options });
  for (const { index, effect, deps } of queued) {
    effects[index]?.cleanup?.();
    effects[index] = { deps, cleanup: effect() };
  }
  return result;
}

const record = (id, overrides = {}) => ({
  id,
  title: `Engineer at ${id}`,
  jobUrl: "",
  status: "applied",
  createdAt: toIso("2026-01-02"),
  updatedAt: toIso("2026-01-02"),
  appliedAt: toIso("2026-01-02"),
  ...overrides
});
const marksSent = () => calls.filter((call) => Array.isArray(call));

server = [record("old-a"), record("old-b"), record("fresh", { appliedAt: new Date().toISOString() })];
local = structuredClone(server);
options = {
  enabled: false,
  afterDays: 21,
  hasLoadedApplications: true,
  pendingWrites: 0,
  trackerError: ""
};

// Off by default: nothing is scheduled.
render();
assert.equal(timers.length, 0, "disabled automation schedules nothing");

// Not ready: unloaded tracker, a write in flight, an error showing, or an
// invalid threshold.
for (const blocked of [
  { enabled: true, hasLoadedApplications: false },
  { enabled: true, pendingWrites: 1 },
  { enabled: true, trackerError: "This application changed in another tab." },
  { enabled: true, afterDays: 3 }
]) {
  render({ enabled: false, afterDays: 21, hasLoadedApplications: true, pendingWrites: 0, trackerError: "" });
  render(blocked);
  await advance(5_000);
  assert.equal(calls.length, 0, `nothing runs while ${JSON.stringify(blocked)}`);
}

// A threshold being typed settles before anything runs: 90 → 12 → 120.
render({ enabled: true, afterDays: 90, hasLoadedApplications: true, pendingWrites: 0, trackerError: "" });
await advance(500);
render({ afterDays: 12 });
await advance(500);
render({ afterDays: 120 });
await advance(1_499);
assert.equal(calls.length, 0, "no pass before the last change settles");
await advance(1);
assert.deepEqual(calls[0], "refresh", "the pass re-reads first");
assert.deepEqual(lockRequests, ["rolefit:auto-ghosting"], "the pass runs under the same-origin tab lock");
assert.deepEqual(
  marksSent()[0][1].map(({ id }) => id).sort(),
  ["old-a", "old-b"],
  "only records silent past the settled threshold are marked"
);
const due = marksSent()[0][1][0].at;
assert.equal(new Date(due).getTime(), new Date(2026, 0, 2 + 120, 12).getTime(), "dated the day the 120-day threshold passed");
render();
assert.equal(result.autoMarkedCount, 2, "the count reports what automatic passes marked");

// The tracker changed (the marks landed): nothing new to do, nothing re-sent.
render({ pendingWrites: 1 });
render({ pendingWrites: 0 });
await advance(2_000);
assert.equal(marksSent().length, 1, "marked records are not marked again");

result.dismissAutoMarked();
render();
assert.equal(result.autoMarkedCount, 0, "dismiss clears the count");

// A failed write is never retried in this session.
server = [...server, record("old-c")];
local = structuredClone(server);
failWrites = true;
render();
await advance(1_500);
assert.equal(marksSent().length, 2, "the new candidate is tried once");
assert.equal(marksSent()[1][1][0].id, "old-c");
failWrites = false;
local = structuredClone(server);
render();
await advance(5_000);
assert.equal(marksSent().length, 2, "the failed id is not retried, even after the tracker changes");
render();
assert.equal(result.autoMarkedCount, 0, "a failed pass marks nothing");

// Another tab holds the lock and marks first: this tab waits, re-reads, and
// finds nothing left, so it sends no conflicting write.
let releaseOtherTab;
const otherTabDone = navigator.locks.request("rolefit:auto-ghosting", () => new Promise((resolve) => {
  releaseOtherTab = resolve;
}));
server = [...server, record("shared")];
local = structuredClone(server);
const writesBefore = marksSent().length;
render();
await advance(1_500);
assert.equal(marksSent().length, writesBefore, "this tab waits while the other tab holds the lock");
server = server.map((application) => application.id === "shared"
  ? { ...application, status: "ghosted", updatedAt: toIso("2026-10-01"), stageHistory: [{ id: "g9", type: "stage", status: "ghosted", at: toIso("2026-01-23") }] }
  : application);
// A record that turns up while the pass waits is evaluated once it finishes.
server = [...server, record("arrived")];
local = [...local, record("arrived")];
render();
await advance(1_500);
releaseOtherTab();
await otherTabDone;
await advance(0);
assert.equal(calls.at(-1), "refresh", "after the lock frees, this tab re-reads");
assert.equal(marksSent().length, writesBefore, "and sends no write for a record the other tab marked");
render();
await advance(1_500);
assert.deepEqual(marksSent().at(-1)[1].map(({ id }) => id), ["arrived"], "a record whose timer fired during the pass is marked by a later pass");
render();
assert.equal(result.autoMarkedCount, 1);

// Turning automation off cancels a pass that has not started.
server = [...server, record("late")];
local = structuredClone(server);
render();
await advance(1_000);
render({ enabled: false });
await advance(5_000);
assert.equal(local.find(({ id }) => id === "late").status, "applied", "switching off before the pass starts marks nothing");

// Another tab turned automation off: this tab's state is stale, but the shared
// cache is read under the lock, so the pass stops before writing.
server = structuredClone(local);
render({ enabled: true });
await advance(2_000);
const beforeStale = marksSent().length;
server = [...server, record("stale-tab")];
local = structuredClone(server);
cacheOverride = { autoMarkGhosted: false, ghostedAfterDays: 21 };
render();
await advance(2_000);
assert.equal(marksSent().length, beforeStale, "a stale tab whose shared cache opted out sends nothing");
cacheOverride = null;

// The record open in Application Detail is never moved under the open form.
server = [...server, record("open-form")];
local = structuredClone(server);
render({ openApplicationId: "open-form" });
await advance(2_000);
assert.ok(
  !marksSent().some((call) => call[1].some(({ id }) => id === "open-form")),
  "the open record is skipped"
);
render({ openApplicationId: null });
await advance(2_000);
assert.ok(
  marksSent().at(-1)[1].some(({ id }) => id === "open-form"),
  "once the form closes, the record is marked"
);

console.log("auto-ghosting hook probes passed");
