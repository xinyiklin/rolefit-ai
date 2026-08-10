import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const bundled = await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../aiJobAnalysis.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent"
});
const { analyzeFitAssessment, analyzeJobPosting } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const POSTING = [
  "Synthetic Systems needs a Backend Engineer.",
  "Build Python APIs and operate SQL data services.",
  "Kubernetes experience is required for production deployments."
].join("\n");
const FIT_REQUEST = {
  resumeText: "Backend Engineer at Synthetic Studio. Built Python APIs and operated SQL data services in production.",
  resumeLabel: "Synthetic resume",
  candidateContext: ""
};
const VALID_FIT = {
  verdict: "REASONABLE",
  matches: [{
    jobExcerpt: "Build Python APIs and operate SQL data services.",
    candidateSource: "RESUME",
    candidateExcerpt: "Built Python APIs and operated SQL data services in production."
  }],
  gaps: ["Kubernetes experience is required for production deployments."],
  eligibility: { status: "CLEAR" }
};
const VALID_ANALYSIS = {
  source: "ai",
  title: "Backend Engineer",
  responsibilities: ["Build Python APIs and operate SQL data services."],
  requiredQualifications: ["Kubernetes experience is required for production deployments."],
  fitAssessment: VALID_FIT
};

let requests = [];
let nextResponse;
globalThis.fetch = async (url, init) => {
  requests.push({ url, init, payload: JSON.parse(init.body) });
  if (nextResponse instanceof Error) throw nextResponse;
  return nextResponse;
};

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
});
const unreadableResponse = () => ({
  ok: true,
  status: 200,
  json: async () => { throw new SyntaxError("synthetic unreadable JSON"); }
});

nextResponse = response(VALID_ANALYSIS);
const combined = await analyzeJobPosting(POSTING, {
  fitAssessment: FIT_REQUEST,
  aiRequest: { provider: "codex-cli", model: "synthetic-model", reasoningEffort: "medium" }
});
assert.equal(combined.source, "ai");
assert.equal(combined.fitAssessment?.verdict, "REASONABLE");
assert.equal(requests.length, 1, "combined analysis uses one endpoint request");
assert.equal(requests[0].url, "/api/job-analysis");
assert.equal(requests[0].payload.mode, undefined);
assert.equal(requests[0].payload.fitAssessment.enabled, true);
assert.equal(requests[0].payload.fitAssessment.resumeText, FIT_REQUEST.resumeText);

requests = [];
nextResponse = response({
  fitAssessment: VALID_FIT,
  provider: "resolved-provider",
  model: "resolved-model",
  reasoningEffort: "resolved-effort",
  attempts: 2
});
const retry = await analyzeFitAssessment(POSTING, FIT_REQUEST, {
  aiRequest: { provider: "claude-cli", model: "synthetic-model", reasoningEffort: "low" }
});
assert.equal(retry.fitAssessment?.verdict, "REASONABLE");
assert.deepEqual(retry.usage, {
  provider: "resolved-provider",
  model: "resolved-model",
  reasoningEffort: "resolved-effort",
  attempts: 2
}, "standalone Fit keeps the server-resolved execution attribution");
assert.equal(requests.length, 1, "reassessment uses the same endpoint boundary once");
assert.equal(requests[0].payload.mode, "fit-assessment");
assert.equal(requests[0].payload.resumeText, FIT_REQUEST.resumeText);

nextResponse = response({ error: "Synthetic provider unavailable." }, 503);
const unavailable = await analyzeFitAssessment(POSTING, FIT_REQUEST);
assert.equal(unavailable.fitAssessment, null);
assert.equal(unavailable.failure?.detail, "Synthetic provider unavailable");

nextResponse = unreadableResponse();
const unreadable = await analyzeFitAssessment(POSTING, FIT_REQUEST);
assert.equal(unreadable.fitAssessment, null);
assert.equal(unreadable.failure?.detail, "Fit Assessment returned unreadable JSON");

nextResponse = response({ source: "unexpected" });
const invalidJob = await analyzeJobPosting(POSTING);
assert.equal(invalidJob.source, "local");
assert.equal(invalidJob.failure?.detail, "The job analyzer returned an invalid response");

nextResponse = response({ fitAssessment: { verdict: "NOT_A_VERDICT" } });
const invalidFit = await analyzeFitAssessment(POSTING, FIT_REQUEST);
assert.equal(invalidFit.fitAssessment, null);
assert.equal(invalidFit.failure?.detail, "Fit Assessment returned no usable screening");

nextResponse = new TypeError("Failed to fetch");
const networkFailure = await analyzeFitAssessment(POSTING, FIT_REQUEST);
assert.equal(networkFailure.failure?.kind, "network");
assert.equal(networkFailure.failure?.detail, "Couldn't reach the local server");

nextResponse = new DOMException("Synthetic abort", "AbortError");
await assert.rejects(
  analyzeFitAssessment(POSTING, FIT_REQUEST),
  (error) => error instanceof DOMException && error.name === "AbortError",
  "a genuine abort still propagates so stale requests cannot settle"
);

console.log("AI Job analysis request evals passed");
