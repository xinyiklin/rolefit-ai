import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const bundled = await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../useJobIntake.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
  plugins: [{
    name: "job-intake-harness",
    setup(build) {
      build.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "harness" }));
      build.onLoad({ filter: /.*/, namespace: "harness" }, () => ({
        loader: "js",
        contents: [
          "export const useState = (initial) => globalThis.__jobIntakeHarness.useState(initial);",
          "export const useRef = (initial) => globalThis.__jobIntakeHarness.useRef(initial);",
          "export const useEffect = (effect, deps) => globalThis.__jobIntakeHarness.useEffect(effect, deps);"
        ].join("\n")
      }));
      build.onResolve({ filter: /^\.\/useExtensionInbox$/ }, () => ({
        path: "useExtensionInbox",
        namespace: "intake-harness"
      }));
      build.onLoad({ filter: /.*/, namespace: "intake-harness" }, () => ({
        loader: "js",
        contents: "export const useExtensionInbox = (...args) => globalThis.__jobIntakeHarness.captureExtension(...args);"
      }));
    }
  }]
});

const { useJobIntake } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const JOB_URL = "https://jobs.example.test/backend-engineer";
const POSTING = [
  "Backend Engineer",
  "Synthetic Systems is hiring a backend engineer to build reliable services.",
  "Responsibilities",
  "Build Python APIs and operate SQL data services in production.",
  "Requirements",
  "Kubernetes experience is required for production deployments."
].join("\n");
const RESUME = [
  "Backend Engineer at Synthetic Studio.",
  "Built Python APIs and operated SQL data services in production.",
  "Partnered with product teams to ship reliable internal platforms."
].join(" ");
const VALID_FIT = {
  verdict: "REASONABLE",
  matches: ["Build Python APIs and operate SQL data services in production."],
  gaps: ["Kubernetes experience is required for production deployments."],
  eligibility: { status: "CLEAR" }
};
const STATE_LABELS = [
  "extracting",
  "extensionPhase",
  "preview",
  "progress",
  "progressVisible",
  "quickFit",
  "retrySource"
];

function assertOrder(log, expected, message) {
  const events = log.map((entry) => entry.event);
  let cursor = -1;
  for (const event of expected) {
    const next = events.indexOf(event, cursor + 1);
    assert.notEqual(next, -1, `${message}: missing ${event} after ${events[cursor] ?? "start"}`);
    cursor = next;
  }
}

function createHarness({
  routeUrl = JOB_URL,
  jobDescription = POSTING,
  runInitialFit = true,
  readiness = { ready: true },
  beforeProceed = true,
  afterProceed = true,
  providerStatus = 200,
  selection = { text: RESUME, label: "Synthetic resume" }
} = {}) {
  const log = [];
  const requests = [];
  const state = [];
  const refs = [];
  const extension = {};
  let stateCursor = 0;
  let refCursor = 0;

  globalThis.__jobIntakeHarness = {
    beginRender() {
      stateCursor = 0;
      refCursor = 0;
    },
    useState(initial) {
      const index = stateCursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (update) => {
        state[index] = typeof update === "function" ? update(state[index]) : update;
        log.push({ event: `state:${STATE_LABELS[index] ?? index}`, value: state[index] });
      }];
    },
    useRef(initial) {
      const index = refCursor++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    },
    useEffect() {},
    captureExtension(onItem, onStart, enabled) {
      extension.onItem = onItem;
      extension.onStart = onStart;
      extension.enabled = enabled;
    }
  };

  const record = (event) => (value) => log.push({ event, value });
  const args = {
    jobUrl: routeUrl,
    setJobUrl: record("setJobUrl"),
    jobDescription,
    setJobDescription: record("setJobDescription"),
    setImportedJob: record("setImportedJob"),
    setResult: record("setResult"),
    resetCoverWorkflow: () => log.push({ event: "resetCoverWorkflow" }),
    setPipelineAiUsage: (update) => log.push({
      event: "setPipelineAiUsage",
      value: update({ prior: { source: "ai" } })
    }),
    setJobRawText: record("setJobRawText"),
    setPolishStatus: record("setPolishStatus"),
    setLinkStatus: record("setLinkStatus"),
    confirmDuplicateBeforeJobAnalysis: async () => {
      log.push({ event: "duplicate:before" });
      return { proceed: beforeProceed, note: beforeProceed ? null : "existing application" };
    },
    confirmDuplicateAfterJobAnalysis: async () => {
      log.push({ event: "duplicate:after" });
      return { proceed: afterProceed, note: afterProceed ? null : "normalized duplicate" };
    },
    jobAnalysisRequestFields: () => ({
      provider: "codex-cli",
      model: "synthetic-model",
      reasoningEffort: "medium"
    }),
    ensureProviderReady: async () => {
      log.push({ event: "provider:ready" });
      return readiness;
    },
    runInitialFit,
    resolvePreparedResume: async (jobText) => {
      log.push({ event: "resolvePreparedResume", value: jobText });
      return selection;
    },
    candidateContext: () => "Authorized to work in the United States.",
    currentResume: () => selection,
    extensionImportsReady: true,
    onExtensionPrepareStarted: () => log.push({ event: "extension:start" }),
    onExtensionJobReceived: () => log.push({ event: "extension:received" })
  };

  globalThis.fetch = async (url, init) => {
    const payload = JSON.parse(init.body);
    requests.push({ url, payload });
    log.push({ event: `fetch:${url}`, value: payload });
    if (url === "/api/import-job") {
      return { ok: true, status: 200, json: async () => ({ text: POSTING }) };
    }
    assert.equal(url, "/api/job-analysis");
    if (providerStatus !== 200) {
      return {
        ok: false,
        status: providerStatus,
        json: async () => ({ error: "Synthetic provider unavailable." })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        source: "ai",
        title: "Backend Engineer",
        company: "Synthetic Systems",
        responsibilities: ["Build Python APIs and operate SQL data services in production."],
        requiredQualifications: ["Kubernetes experience is required for production deployments."],
        provider: "codex-cli",
        model: "synthetic-model",
        reasoningEffort: "medium",
        attempts: 1,
        ...(payload.initialFit ? { initialFit: VALID_FIT } : {})
      })
    };
  };

  return {
    args,
    extension,
    log,
    requests,
    state,
    render() {
      globalThis.__jobIntakeHarness.beginRender();
      return useJobIntake(args);
    }
  };
}

async function runUrl(harness) {
  await harness.render().handleExtractFromLink();
}

async function runPaste(harness) {
  await harness.render().handleAnalyzePaste();
}

async function runExtension(harness) {
  harness.render();
  await harness.extension.onItem({ text: POSTING, url: JOB_URL });
}

const sharedCommitOrder = [
  "duplicate:before",
  "state:preview",
  "resolvePreparedResume",
  "fetch:/api/job-analysis",
  "duplicate:after",
  "setJobDescription",
  "setImportedJob",
  "state:preview",
  "setResult",
  "resetCoverWorkflow",
  "setPipelineAiUsage",
  "setJobRawText",
  "state:quickFit"
];

{
  const harness = createHarness();
  await runUrl(harness);
  assertOrder(harness.log, ["fetch:/api/import-job", ...sharedCommitOrder], "URL intake order");
  assert.equal(harness.requests.filter(({ url }) => url === "/api/job-analysis").length, 1);
  assert.equal(harness.state[5].status, "ready", "URL intake settles fit after the snapshot commit");
}

{
  const harness = createHarness();
  await runPaste(harness);
  assertOrder(harness.log, sharedCommitOrder, "paste intake order");
  assert.equal(harness.requests.some(({ url }) => url === "/api/import-job"), false);
}

{
  const harness = createHarness();
  await runExtension(harness);
  assertOrder(harness.log, ["extension:received", "provider:ready", ...sharedCommitOrder], "extension intake order");
  assert.equal(harness.state[6], "import", "extension intake records a retryable source");

  harness.log.length = 0;
  const retry = harness.render().jobAnalysisRetry;
  assert.equal(typeof retry, "function", "extension intake exposes Retry after settling");
  await retry();
  assertOrder(harness.log, sharedCommitOrder, "extension Retry order");
  assert.equal(harness.log.some(({ event }) => event === "fetch:/api/import-job"), false);
}

{
  const harness = createHarness({ beforeProceed: false });
  await runPaste(harness);
  assert.equal(harness.log.some(({ event }) => event === "fetch:/api/job-analysis"), false);
  assert.equal(harness.log.some(({ event }) => event === "resolvePreparedResume"), false);
  assert.equal(harness.log.some(({ event }) => event === "setImportedJob"), true);
  assert.equal(harness.state[5].status, "unavailable", "a pre-analysis duplicate cannot retain a fit");
}

{
  const harness = createHarness({ afterProceed: false });
  await runPaste(harness);
  assertOrder(harness.log, [...sharedCommitOrder, "state:progress", "setLinkStatus"], "post-analysis duplicate order");
  assert.equal(harness.state[3].status, "stopped");
  assert.equal(harness.state[5].status, "ready", "post-analysis duplicate review retains completed Initial Fit");
}

{
  const harness = createHarness({ readiness: { ready: false, message: "No provider configured." } });
  await runPaste(harness);
  assert.equal(harness.log.some(({ event }) => event === "fetch:/api/job-analysis"), false);
  assert.equal(harness.log.filter(({ event }) => event === "resolvePreparedResume").length, 1);
  assert.equal(harness.state[5].status, "unavailable");
  assert.match(
    harness.log.filter(({ event }) => event === "setLinkStatus").at(-1).value,
    /local brief is ready/i,
    "provider readiness failure commits the deterministic local brief"
  );
}

{
  const harness = createHarness({ providerStatus: 503 });
  await runPaste(harness);
  assert.equal(harness.requests.filter(({ url }) => url === "/api/job-analysis").length, 1);
  assert.equal(harness.state[5].status, "unavailable");
  assert.match(
    harness.log.filter(({ event }) => event === "setLinkStatus").at(-1).value,
    /local brief is ready/i,
    "provider HTTP failure falls back locally without losing the preparation"
  );
}

{
  const harness = createHarness({ runInitialFit: false });
  await runPaste(harness);
  assert.equal(harness.log.filter(({ event }) => event === "resolvePreparedResume").length, 1);
  const request = harness.requests.find(({ url }) => url === "/api/job-analysis");
  assert.equal(request.payload.initialFit, undefined, "disabled Initial Fit sends no resume payload");
  assert.equal(harness.state[5].status, "disabled");
}

{
  const harness = createHarness();
  await runPaste(harness);
  const request = harness.requests.find(({ url }) => url === "/api/job-analysis");
  assert.equal(request.payload.initialFit.enabled, true);
  assert.equal(request.payload.initialFit.resumeText, RESUME);
  assertOrder(
    harness.log,
    ["state:preview", "resolvePreparedResume", "fetch:/api/job-analysis"],
    "resume resolution occurs after local preview and before provider dispatch"
  );
}

console.log("Job intake entry-point characterization: passed");
