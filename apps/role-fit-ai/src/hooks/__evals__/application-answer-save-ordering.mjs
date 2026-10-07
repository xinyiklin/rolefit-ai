import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { extractAnswerConstraints, validateAnswerConstraints } from "../../../shared/applicationAnswersContract.ts";
import { sanitizeApplications } from "../../../server/applications/schema.ts";
import { reconcileApplicationMutations } from "../../../server/applications/reconcile.ts";

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


let stored = [];
let writes = 0;
let heldWrite;
let loseNextResponse = false;
globalThis.fetch = async (url, init = {}) => {
  assert.equal(url, "/api/applications");
  if (init.method !== "PUT") return { ok: true, status: 200, json: async () => ({ applications: structuredClone(stored) }) };
  writes += 1;
  const payload = JSON.parse(init.body);
  if (heldWrite) await heldWrite.promise;
  try {
    stored = reconcileApplicationMutations(stored, sanitizeApplications(payload.applications), payload.mutations);
  } catch (error) {
    return { ok: false, status: error.status, json: async () => ({ error: error.message, applications: structuredClone(stored) }) };
  }
  if (loseNextResponse) { loseNextResponse = false; throw new Error("Synthetic lost response"); }
  return { ok: true, status: 200, json: async () => ({ applications: structuredClone(stored) }) };
};
const app = renderApplications();
await app.refresh();
const target = { draftId: "draft-first", jobUrl: "https://example.test/first", jobDescription: "Original prepared job", rawJobDescription: "Captured posting", metadata: { role: "Engineer", company: "Synthetic" } };
const question = "Why this role? Under 150 words.";
function answer(id, text = "I enjoy making tools easier to use.") {
  const constraints = extractAnswerConstraints(question);
  const validation = validateAnswerConstraints(text, constraints);
  return { id, applicationId: "preparation-first", questionId: "question-first", questionRevision: 1, question, answer: text, status: "ready", constraints, counts: validation.counts, compliant: validation.compliant };
}
heldWrite = deferred();
const firstAnswer = answer("revision-a");
const first = app.saveApplicationAnswer({ target, answer: firstAnswer });
await waitFor(() => writes === 1, "first save did not start");
const duplicate = app.saveApplicationAnswer({ target, answer: firstAnswer });
const newer = app.saveApplicationAnswer({ target, answer: answer("revision-b", "I enjoy helping teams build reliable tools.") });
firstAnswer.answer = "Mutated after the save began.";
heldWrite.resolve();
heldWrite = null;
const results = await Promise.all([first, duplicate, newer]);
assert.equal(new Set(results.map((record) => record.id)).size, 1);
assert.equal(writes, 3, "each save confirms the target while a double click never duplicates its revision");
assert.equal(stored.length, 1);
assert.equal(stored[0].status, "draft");
assert.equal(stored[0].appliedAt, undefined);
assert.equal(stored[0].applicationAnswers.length, 2);
assert.equal(stored[0].applicationAnswers[0].answer, "I enjoy making tools easier to use.", "captured revision survives subsequent caller edits");
assert.equal(stored[0].applicationAnswers[0].originId, "preparation-first");
assert.equal(stored[0].applicationAnswers[0].applicationId, target.draftId);
await app.saveApplicationAnswer({ target: { applicationId: target.draftId }, answer: answer("revision-a") });
assert.equal(writes, 4, "saving an older response confirms that exact revision without replacement or duplicates");
await assert.rejects(app.saveApplicationAnswer({ target, answer: answer("revision-a", "Different same-id content.") }), (error) => error.code === "conflict");
await assert.rejects(app.saveApplicationAnswer({ target: { applicationId: "missing" }, answer: answer("missing-revision") }), (error) => error.code === "deleted");

loseNextResponse = true;
const lostTarget = { ...target, draftId: "draft-lost" };
await assert.rejects(app.saveApplicationAnswer({ target: lostTarget, answer: answer("revision-lost") }), /lost response/);
assert.equal(stored.filter((record) => record.id === lostTarget.draftId).length, 1);
const retry = await app.saveApplicationAnswer({ target: lostTarget, answer: answer("revision-lost") });
assert.equal(retry.id, lostTarget.draftId);
assert.equal(stored.filter((record) => record.id === lostTarget.draftId).length, 1, "retry after committed response loss reuses the original Draft");
assert.equal(retry.applicationAnswers.length, 1);

const thirdTarget = { ...target, draftId: "draft-other", jobUrl: "https://example.test/other" };
await app.saveApplicationAnswer({ target: thirdTarget, answer: answer("revision-other") });
const original = stored.find((record) => record.id === target.draftId);
original.updatedAt = new Date(Date.parse(original.updatedAt) + 100).toISOString();
original.notes = "Synthetic edit in another tab";
await assert.rejects(app.saveApplicationAnswer({ target: { applicationId: target.draftId }, answer: answer("revision-conflict") }), (error) => error.code === "conflict");
assert.equal(stored.find((record) => record.id === target.draftId).applicationAnswers.length, 2);
assert.equal(stored.find((record) => record.id === thirdTarget.draftId).applicationAnswers.length, 1, "an old save never follows the newer open application");
stored = stored.filter((record) => record.id !== target.draftId);
await assert.rejects(app.saveApplicationAnswer({ target, answer: answer("revision-a") }), (error) => error.code === "conflict", "even a repeated revision must confirm that its application still exists");
await app.refresh();
await assert.rejects(app.saveApplicationAnswer({ target, answer: answer("revision-deleted") }), (error) => error.code === "deleted", "a previously confirmed Draft is never recreated after deletion");
console.log("Application answer save ordering passed: first-save concurrency, exact snapshots, revision history, response-loss retry, conflicts, identity and deletion");
