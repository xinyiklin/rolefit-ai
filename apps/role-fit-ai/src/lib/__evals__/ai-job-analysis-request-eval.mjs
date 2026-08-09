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
const { analyzeInitialFit, analyzeJobPosting } = await import(
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
  matches: ["Build Python APIs and operate SQL data services."],
  gaps: ["Kubernetes experience is required for production deployments."],
  eligibility: { status: "CLEAR" }
};
const VALID_ANALYSIS = {
  source: "ai",
  title: "Backend Engineer",
  responsibilities: ["Build Python APIs and operate SQL data services."],
  requiredQualifications: ["Kubernetes experience is required for production deployments."],
  initialFit: VALID_FIT
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
  initialFit: FIT_REQUEST,
  aiRequest: { provider: "codex-cli", model: "synthetic-model", reasoningEffort: "medium" }
});
assert.equal(combined.source, "ai");
assert.equal(combined.initialFit?.verdict, "REASONABLE");
assert.equal(requests.length, 1, "combined analysis uses one endpoint request");
assert.equal(requests[0].url, "/api/job-analysis");
assert.equal(requests[0].payload.mode, undefined);
assert.equal(requests[0].payload.initialFit.enabled, true);
assert.equal(requests[0].payload.initialFit.resumeText, FIT_REQUEST.resumeText);

requests = [];
nextResponse = response({ initialFit: VALID_FIT });
const retry = await analyzeInitialFit(POSTING, FIT_REQUEST, {
  aiRequest: { provider: "claude-cli", model: "synthetic-model", reasoningEffort: "low" }
});
assert.equal(retry.initialFit?.verdict, "REASONABLE");
assert.equal(requests.length, 1, "fit-only retry uses the same endpoint boundary once");
assert.equal(requests[0].payload.mode, "initial-fit");
assert.equal(requests[0].payload.resumeText, FIT_REQUEST.resumeText);

nextResponse = response({ error: "Synthetic provider unavailable." }, 503);
const unavailable = await analyzeInitialFit(POSTING, FIT_REQUEST);
assert.equal(unavailable.initialFit, null);
assert.equal(unavailable.failure?.detail, "Synthetic provider unavailable");

nextResponse = unreadableResponse();
const unreadable = await analyzeInitialFit(POSTING, FIT_REQUEST);
assert.equal(unreadable.initialFit, null);
assert.equal(unreadable.failure?.detail, "Initial Fit returned unreadable JSON");

nextResponse = response({ source: "unexpected" });
const invalidJob = await analyzeJobPosting(POSTING);
assert.equal(invalidJob.source, "local");
assert.equal(invalidJob.failure?.detail, "The job analyzer returned an invalid response");

nextResponse = response({ initialFit: { verdict: "NOT_A_VERDICT" } });
const invalidFit = await analyzeInitialFit(POSTING, FIT_REQUEST);
assert.equal(invalidFit.initialFit, null);
assert.equal(invalidFit.failure?.detail, "Initial Fit returned no usable screening");

nextResponse = new TypeError("Failed to fetch");
const networkFailure = await analyzeInitialFit(POSTING, FIT_REQUEST);
assert.equal(networkFailure.failure?.kind, "network");
assert.equal(networkFailure.failure?.detail, "Couldn't reach the local server");

nextResponse = new DOMException("Synthetic abort", "AbortError");
await assert.rejects(
  analyzeInitialFit(POSTING, FIT_REQUEST),
  (error) => error instanceof DOMException && error.name === "AbortError",
  "a genuine abort still propagates so stale requests cannot settle"
);

console.log("AI Job analysis request evals passed");
