// Revision-aware tracker sync in useApplications: writes send the revision the
// confirmed tracker reflects, sparse responses rebuild it without disturbing
// unchanged rows, refresh skips an unchanged tracker (304) yet adopts any other
// tab's change, a 409 adopts the conflict snapshot's revision, and an unusable
// sparse response falls back to a full read. Driven against an in-memory server
// that follows the /api/applications revision protocol.

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
function render() {
  stateCursor = 0;
  refCursor = 0;
  return useApplications();
}

// ── In-memory server following the revision protocol ────────────────────────
let serverApps = [];
let revisionCounter = 0;
let revision = `r${revisionCounter}`;
const requests = [];
let corruptNextPartial = false;
const bump = () => { revision = `r${++revisionCounter}`; };
const clone = (list) => list.map((application) => ({ ...application }));
const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (status === 304) throw new Error("304 has no body");
    return body;
  }
});

globalThis.fetch = async (url, init = {}) => {
  assert.equal(url, "/api/applications");
  if (init.method === "PUT") {
    const payload = JSON.parse(init.body);
    requests.push({ method: "PUT", baseRevision: payload.baseRevision });
    const before = revision;
    for (const mutation of payload.mutations) {
      const current = serverApps.find(({ id }) => id === mutation.id);
      if ((current?.updatedAt ?? null) !== mutation.baseUpdatedAt) {
        return reply(409, { error: "Changed in another tab.", applications: clone(serverApps), revision: before });
      }
    }
    for (const mutation of payload.mutations) {
      const index = serverApps.findIndex(({ id }) => id === mutation.id);
      const record = payload.applications.find(({ id }) => id === mutation.id);
      if (mutation.operation === "delete") serverApps.splice(index, 1);
      else if (index >= 0) serverApps[index] = record;
      else serverApps.unshift(record);
    }
    bump();
    if (payload.baseRevision === before) {
      const upserted = new Set(payload.applications.map(({ id }) => id));
      const order = serverApps.map(({ id }) => id);
      if (corruptNextPartial) {
        corruptNextPartial = false;
        order.push("never-sent");
      }
      return reply(200, { revision, order, applications: clone(serverApps.filter(({ id }) => upserted.has(id))) });
    }
    return reply(200, { revision, applications: clone(serverApps) });
  }
  const ifNoneMatch = init.headers?.["If-None-Match"];
  requests.push({ method: "GET", ifNoneMatch });
  if (ifNoneMatch === `"${revision}"`) return reply(304);
  return reply(200, { revision, applications: clone(serverApps), path: "workspace/applications.json" });
};

function record(id, overrides = {}) {
  return {
    id,
    title: `Engineer at ${id}`,
    status: "applied",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    appliedAt: "2026-08-01T00:00:00.000Z",
    ...overrides
  };
}
const ids = () => render().applications.map(({ id }) => id);
const lastRequest = () => requests[requests.length - 1];

// The first read is unconditional and adopts the server revision.
serverApps = [record("a"), record("b"), record("c")];
bump();
assert.equal(await render().refresh(), true);
assert.equal(lastRequest().ifNoneMatch, undefined, "a tab with no revision reads unconditionally");
assert.deepEqual(ids(), ["a", "b", "c"]);
const untouchedB = render().applications[1];

// A write sends the confirmed revision and gets a sparse response.
const r1 = revision;
assert.equal(await render().createApplication(record("d")), true);
assert.equal(lastRequest().baseRevision, r1, "a write sends the revision its tracker reflects");
assert.deepEqual(ids(), ["d", "a", "b", "c"], "a sparse response rebuilds the full order");
assert.equal(render().applications[2], untouchedB, "unchanged rows keep their object references");

// Two queued writes chain revisions in order.
const editA = render().updateApplicationById({ ...render().getApplication("a"), notes: "first" });
const editC = render().updateApplicationById({ ...render().getApplication("c"), notes: "second" });
assert.deepEqual(await Promise.all([editA, editC]), [true, true]);
const [firstPut, secondPut] = requests.slice(-2);
assert.notEqual(firstPut.baseRevision, secondPut.baseRevision, "the second queued write sends the first write's new revision");
assert.equal(lastRequest().method, "PUT");
assert.equal(render().getApplication("a").notes, "first");
assert.equal(render().getApplication("c").notes, "second");

// An unchanged tracker refreshes with 304 and keeps every object.
const beforeRefresh = render().applications;
assert.equal(await render().refresh(), true);
assert.equal(lastRequest().ifNoneMatch, `"${revision}"`, "refresh sends the confirmed revision");
assert.deepEqual(render().applications, beforeRefresh, "a 304 keeps the confirmed tracker");
assert.equal(render().applications[0], beforeRefresh[0]);

// Another tab's change arrives on the next refresh.
serverApps = serverApps.map((application) => (application.id === "b" ? { ...application, notes: "other tab", updatedAt: "2026-08-02T00:00:00.000Z" } : application));
bump();
assert.equal(await render().refresh(), true);
assert.equal(render().getApplication("b").notes, "other tab", "refresh adopts another tab's change");

// ...and on the next save when no refresh happened in between.
serverApps = serverApps.map((application) => (application.id === "c" ? { ...application, notes: "other tab again", updatedAt: "2026-08-03T00:00:00.000Z" } : application));
bump();
assert.equal(await render().updateApplicationById({ ...render().getApplication("d"), notes: "mine" }), true);
assert.equal(render().getApplication("c").notes, "other tab again", "a stale-revision save adopts the full tracker");
assert.equal(render().getApplication("d").notes, "mine");

// A conflict adopts the server snapshot and its revision.
serverApps = serverApps.map((application) => (application.id === "a" ? { ...application, notes: "theirs", updatedAt: "2026-08-04T00:00:00.000Z" } : application));
bump();
const conflictRevision = revision;
const staleA = { ...render().getApplication("a"), notes: "ours" };
assert.equal(await render().updateApplicationById(staleA), false);
assert.equal(render().getApplication("a").notes, "theirs", "a conflict restores the server snapshot");
assert.equal(await render().updateApplicationById({ ...render().getApplication("b"), notes: "after conflict" }), true);
assert.equal(lastRequest().baseRevision, conflictRevision, "the next write sends the conflict snapshot's revision");

// An outside edit that kept updatedAt arrives through a stale-revision save's
// full response and is not masked by a later 304.
serverApps = serverApps.map((application) => (application.id === "d" ? { ...application, notes: "edited on disk" } : application));
bump();
assert.equal(await render().updateApplicationById({ ...render().getApplication("b"), notes: "after outside edit" }), true);
assert.equal(render().getApplication("d").notes, "edited on disk", "a full response replaces a held row with an unchanged updatedAt");
assert.equal(await render().refresh(), true);
assert.equal(render().getApplication("d").notes, "edited on disk", "the following refresh keeps the outside edit");

// An unusable sparse response falls back to one full read.
corruptNextPartial = true;
const getsBefore = requests.filter(({ method }) => method === "GET").length;
assert.equal(await render().updateApplicationById({ ...render().getApplication("c"), notes: "fallback" }), true);
assert.equal(requests.filter(({ method }) => method === "GET").length, getsBefore + 1, "a bad sparse response triggers one full read");
assert.equal(lastRequest().ifNoneMatch, undefined, "the fallback read is unconditional");
assert.deepEqual(ids(), serverApps.map(({ id }) => id));
assert.equal(render().getApplication("c").notes, "fallback");

console.log("Applications revision sync passed");
