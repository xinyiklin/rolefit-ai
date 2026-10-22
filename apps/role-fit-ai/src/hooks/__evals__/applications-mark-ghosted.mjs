// useApplications.markGhosted: a bulk mark is ONE revision-checked PUT carrying
// one upsert per still-markable record, accepted by the real server reconcile;
// a full timeline refuses the batch before any request, and a conflict
// restores the server's tracker without retrying.

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { sanitizeApplications } from "../../../server/applications/schema.ts";
import { reconcileApplicationMutations } from "../../../server/applications/reconcile.ts";
import { STAGE_HISTORY_MAX_ENTRIES } from "../../../shared/applicationStageHistoryContract.ts";

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

// In-memory server running the real sanitizer and reconcile.
let serverApps = [];
let revisionCounter = 0;
const revision = () => `r${revisionCounter}`;
const puts = [];
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
globalThis.fetch = async (url, init = {}) => {
  assert.equal(url, "/api/applications");
  if (init.method !== "PUT") {
    return reply(200, { revision: revision(), applications: structuredClone(serverApps), path: "workspace/applications.json" });
  }
  const payload = JSON.parse(init.body);
  puts.push(payload);
  try {
    serverApps = reconcileApplicationMutations(
      sanitizeApplications(serverApps),
      sanitizeApplications(payload.applications),
      payload.mutations
    );
  } catch (error) {
    return reply(error.status ?? 400, {
      error: error.message,
      ...(error.status === 409 ? { applications: structuredClone(serverApps), revision: revision() } : {})
    });
  }
  revisionCounter += 1;
  return reply(200, { revision: revision(), applications: structuredClone(serverApps) });
};

const record = (id, overrides = {}) => ({
  id,
  title: `Engineer at ${id}`,
  jobUrl: "",
  status: "applied",
  createdAt: "2026-08-01T16:00:00.000Z",
  updatedAt: "2026-08-01T16:00:00.000Z",
  appliedAt: "2026-08-01T16:00:00.000Z",
  ...overrides
});
const dueA = "2026-08-22T16:00:00.000Z";
const dueB = "2026-09-01T16:00:00.000Z";

serverApps = sanitizeApplications([
  record("a"),
  record("b", { status: "interviewing", stageHistory: [{ id: "s1", type: "stage", status: "interviewing", at: "2026-08-05T16:00:00.000Z" }] }),
  record("closed", { status: "rejected", stageHistory: [{ id: "s2", type: "stage", status: "rejected", at: "2026-08-06T16:00:00.000Z" }] }),
  record("full", { stageHistory: Array.from({ length: STAGE_HISTORY_MAX_ENTRIES }, (_, index) => ({ id: `f${index}`, type: "followup", at: "2026-08-02T16:00:00.000Z" })) })
]);
assert.equal(await render().refresh(), true);

// A full timeline anywhere in the batch: refused up front, nothing sent.
assert.equal(await render().markGhosted([{ id: "a", at: dueA }, { id: "full", at: dueA }]), null);
assert.equal(puts.length, 0, "a refused batch sends no request");
assert.match(render().error, /^.+'s timeline is full\. /, "the refusal names the record whose timeline is full");
assert.equal(render().getApplication("a").status, "applied", "a refused batch changes no record");

// Nothing still markable: no request, not a failure.
assert.equal(await render().markGhosted([{ id: "closed", at: dueA }, { id: "missing", at: dueA }]), 0);
assert.equal(puts.length, 0, "nothing to mark sends no request");

// One write carries every mark.
assert.equal(
  await render().markGhosted([{ id: "a", at: dueA }, { id: "b", at: dueB }, { id: "closed", at: dueA }]),
  2,
  "resolves to how many were marked, not how many were asked"
);
assert.equal(puts.length, 1, "the bulk mark is one request");
assert.deepEqual(
  puts[0].mutations.map(({ id, operation }) => [id, operation]),
  [["a", "upsert"], ["b", "upsert"]],
  "one upsert per markable record; a closed one is skipped"
);
assert.deepEqual(puts[0].applications.map(({ id }) => id), ["a", "b"], "only mutation-named records are sent");
for (const [id, at] of [["a", dueA], ["b", dueB]]) {
  const saved = serverApps.find((application) => application.id === id);
  assert.equal(saved.status, "ghosted", `${id} is stored as Ghosted`);
  const { type, status, at: enteredAt } = saved.stageHistory.at(-1);
  assert.deepEqual({ type, status, at: enteredAt }, { type: "stage", status: "ghosted", at }, `${id} records its own date`);
  assert.equal(render().getApplication(id).status, "ghosted");
}
assert.equal(serverApps.find(({ id }) => id === "closed").status, "rejected");
assert.equal(render().pendingWrites, 0);

// Another tab changed one record: the whole batch conflicts, the server's
// tracker is restored, and nothing is retried.
serverApps = sanitizeApplications([
  ...serverApps.filter(({ id }) => id !== "closed"),
  record("c"),
  record("d")
]);
revisionCounter += 1;
assert.equal(await render().refresh(), true);
serverApps = serverApps.map((application) => application.id === "d"
  ? { ...application, notes: "other tab", updatedAt: "2026-10-01T16:00:00.000Z" }
  : application);
revisionCounter += 1;
assert.equal(await render().markGhosted([{ id: "c", at: dueA }, { id: "d", at: dueA }]), null);
assert.equal(puts.length, 2, "the conflicting batch was one request");
assert.equal(serverApps.find(({ id }) => id === "c").status, "applied", "a conflict commits no part of the batch");
assert.equal(render().getApplication("c").status, "applied", "the optimistic marks roll back");
assert.equal(render().getApplication("d").notes, "other tab", "the other tab's change is adopted");
assert.match(render().error, /changed in another tab/);

console.log("applications markGhosted probes passed");
