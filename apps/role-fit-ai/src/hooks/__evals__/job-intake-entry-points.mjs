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
  matches: [{
    jobExcerpt: "Build Python APIs and operate SQL data services in production.",
    candidateSource: "RESUME",
    candidateExcerpt: "Built Python APIs and operated SQL data services in production."
  }],
  gaps: ["Kubernetes experience is required for production deployments."],
  eligibility: { status: "CLEAR" }
};
const STATE_LABELS = [
  "extracting",
  "extensionPhase",
  "preview",
  "progress",
  "progressVisible",
  "fitAssessment",
  "retrySource",
  "committedPreparation"
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
  jobRawText = "",
  runFitAssessment = true,
  readiness = { ready: true },
  beforeProceed = true,
  afterProceed = true,
  providerStatus = 200,
  fitProvider = "codex-cli",
  fitModel = "synthetic-model",
  fitReasoningEffort = "medium",
  fitReadiness = { ready: true },
  readinessImpl,
  fitReadinessImpl,
  requestFieldsRef,
  jobAnalysisGate,
  fitResponseGate,
  selection = { text: RESUME, label: "Synthetic resume" },
  resolvePreparedResumeImpl,
  analysisBody,
  afterError
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
    jobRawText,
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
      if (afterError) throw afterError;
      return { proceed: afterProceed, note: afterProceed ? null : "normalized duplicate" };
    },
    jobAnalysisRequestFields: () => requestFieldsRef?.current ?? ({
      provider: "codex-cli",
      model: "synthetic-model",
      reasoningEffort: "medium"
    }),
    fitAssessmentRequestFields: () => ({
      provider: fitProvider,
      model: fitModel,
      reasoningEffort: fitReasoningEffort
    }),
    ensureProviderReady: async (request) => {
      log.push({ event: "provider:ready", value: request });
      return readinessImpl ? readinessImpl(request) : readiness;
    },
    ensureFitAssessmentProviderReady: async (request) => {
      log.push({ event: "provider:fit-ready", value: request });
      return fitReadinessImpl ? fitReadinessImpl(request) : fitReadiness;
    },
    runFitAssessment,
    resolvePreparedResume: async (jobText, controls) => {
      log.push({ event: "resolvePreparedResume", value: jobText });
      return resolvePreparedResumeImpl
        ? resolvePreparedResumeImpl({ jobText, controls, selection, log })
        : selection;
    },
    cancelPreparedResumeResolution: () => log.push({ event: "cancelPreparedResumeResolution" }),
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
    if (payload.mode === "fit-assessment") {
      if (fitResponseGate) await fitResponseGate.promise;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          source: "ai",
          fitAssessment: VALID_FIT,
          provider: payload.provider,
          model: payload.model,
          reasoningEffort: payload.reasoningEffort
        })
      };
    }
    if (jobAnalysisGate && requests.filter((request) => (
      request.url === "/api/job-analysis" && request.payload.mode !== "fit-assessment"
    )).length === 1) {
      await jobAnalysisGate.promise;
    }
    return analysisBody ?? {
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
        ...(payload.fitAssessment ? { fitAssessment: VALID_FIT } : {})
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

async function settleAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
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
  "state:fitAssessment"
];

{
  const harness = createHarness();
  await runUrl(harness);
  assertOrder(harness.log, ["fetch:/api/import-job", ...sharedCommitOrder], "URL intake order");
  assert.equal(harness.requests.filter(({ url }) => url === "/api/job-analysis").length, 1);
  assert.equal(harness.state[5].activeRun, null, "URL intake settles its Prepare-owned Fit request");
  assert.equal(harness.state[5].latestCompleted?.snapshot.result.verdict, "REASONABLE");
}

{
  const harness = createHarness({
    fitProvider: "anthropic",
    fitModel: "claude-opus-4-8",
    fitReasoningEffort: "high"
  });
  await runPaste(harness);
  const providerRequests = harness.requests.filter(({ url }) => url === "/api/job-analysis");
  assert.equal(providerRequests.length, 2, "distinct Job analysis and Fit settings dispatch two provider requests");
  assert.equal(providerRequests[0].payload.provider, "codex-cli");
  assert.equal(providerRequests[0].payload.fitAssessment, undefined, "Job analysis does not absorb a differently configured Fit stage");
  assert.equal(providerRequests[1].payload.mode, "fit-assessment");
  assert.equal(providerRequests[1].payload.provider, "anthropic", "Fit Assessment uses its own provider");
  assert.equal(providerRequests[1].payload.model, "claude-opus-4-8", "Fit Assessment uses its own model");
  assert.equal(harness.state[5].activeRun, null, "the separately configured Fit stage settles inside Prepare");
  assert.equal(harness.state[5].latestCompleted.snapshot.provider, "anthropic", "Fit provenance records the Fit provider, not Job analysis");
}

{
  const fitResponseGate = deferred();
  const harness = createHarness({
    fitProvider: "anthropic",
    fitModel: "claude-opus-4-8",
    fitResponseGate
  });
  let prepareSettled = false;
  const pending = runPaste(harness).then(() => { prepareSettled = true; });
  await settleAsyncWork();
  assert.equal(prepareSettled, false, "Prepare remains unsettled while its separate first Fit request is running");
  assert.equal(harness.state[5].activeRun?.kind, "prepare");
  fitResponseGate.resolve();
  await pending;
  assert.equal(prepareSettled, true);
}

{
  const fitResponseGate = deferred();
  const harness = createHarness({
    fitProvider: "anthropic",
    fitModel: "claude-opus-4-8",
    fitResponseGate
  });
  const pending = runPaste(harness);
  await settleAsyncWork();
  harness.render().stopJobAnalysis();
  fitResponseGate.resolve();
  await pending;
  assert.equal(
    harness.state[3].status,
    "stopped",
    "a late standalone Fit completion cannot overwrite an explicit Prepare stop"
  );
  assert.equal(harness.state[5].activeRun, null, "Stop terminalizes the awaited Fit run");
  assert.match(
    harness.log.filter(({ event }) => event === "setLinkStatus").at(-1).value,
    /stopped/i,
    "the outer handler does not publish a success message after Stop"
  );
}

{
  const harness = createHarness();
  await runPaste(harness);
  assertOrder(harness.log, sharedCommitOrder, "paste intake order");
  assert.equal(harness.requests.some(({ url }) => url === "/api/import-job"), false);
}

{
  const harness = createHarness({ jobRawText: POSTING });
  await runPaste(harness);
  harness.args.jobDescription = `${POSTING}\nCorrected required qualification: Helm.`;
  assert.equal(
    harness.render().canAssessFit,
    true,
    "editing the structured prepared brief does not replace the captured screening source"
  );
  harness.args.jobRawText = "";
  harness.args.jobDescription = `${POSTING}\nReplacement source posting.`;
  assert.equal(
    harness.render().canAssessFit,
    false,
    "replacing the raw source marks the committed preparation as diverged"
  );
  harness.args.jobRawText = POSTING;
  harness.args.jobDescription = POSTING;
  harness.args.jobUrl = `${JOB_URL}?replacement=1`;
  assert.equal(
    harness.render().canAssessFit,
    false,
    "changing the source URL also marks the committed preparation as diverged"
  );
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
  assert.equal(harness.state[5].latestCompleted, null, "a pre-analysis duplicate cannot create a completed Fit");
  assert.match(harness.state[5].lastError?.message ?? "", /duplicate review stopped/i);
}

{
  const harness = createHarness({ afterProceed: false });
  await runPaste(harness);
  assertOrder(harness.log, [...sharedCommitOrder, "state:progress", "setLinkStatus"], "post-analysis duplicate order");
  assert.equal(harness.state[3].status, "stopped");
  assert.equal(harness.state[5].latestCompleted?.snapshot.result.verdict, "REASONABLE", "post-analysis duplicate review retains completed Fit Assessment");
  assert.equal(
    harness.state[5].latestCompleted?.automationToken,
    undefined,
    "a completed combined assessment cannot authorize downstream Polish after duplicate review stops"
  );
}

{
  const harness = createHarness({
    afterProceed: false,
    fitProvider: "anthropic",
    fitModel: "claude-opus-4-8",
    fitReasoningEffort: "high"
  });
  await runPaste(harness);
  assert.equal(
    harness.requests.filter(({ url }) => url === "/api/job-analysis").length,
    1,
    "a post-analysis duplicate stop makes no separate Fit Assessment request"
  );
  assert.equal(
    harness.log.some(({ event }) => event === "provider:fit-ready"),
    false,
    "duplicate review stops before Fit provider readiness"
  );
  assert.equal(harness.state[5].latestCompleted, null);
  assert.match(harness.state[5].lastError?.message ?? "", /duplicate review stopped/i);
}

{
  const harness = createHarness({ readiness: { ready: false, message: "No provider configured." } });
  await runPaste(harness);
  assert.equal(harness.log.some(({ event }) => event === "fetch:/api/job-analysis"), false);
  assert.equal(harness.log.filter(({ event }) => event === "resolvePreparedResume").length, 1);
  assert.equal(harness.state[5].latestCompleted, null);
  assert.match(harness.state[5].lastError?.message ?? "", /unavailable/i);
  assert.match(
    harness.log.filter(({ event }) => event === "setLinkStatus").at(-1).value,
    /local brief is ready/i,
    "provider readiness failure commits the deterministic local brief"
  );
}

{
  const harness = createHarness({
    analysisBody: {
      ok: true,
      status: 200,
      json: async () => ({
        source: "ai",
        responsibilities: ["Build."],
        provider: "codex-cli",
        model: "synthetic-model",
        reasoningEffort: "medium",
        attempts: 1,
        fitAssessment: VALID_FIT
      })
    }
  });
  await runPaste(harness);
  assert.equal(
    harness.state[5].activeRun,
    null,
    "a too-short final brief terminalizes the Fit Assessment started by preparation"
  );
}

{
  const harness = createHarness({ afterError: new Error("Synthetic duplicate lookup failure") });
  await runPaste(harness);
  assert.equal(
    harness.state[5].activeRun,
    null,
    "an unexpected post-resolution failure cannot strand Fit Assessment in running"
  );
}

{
  const resolutionGate = deferred();
  const harness = createHarness({
    resolvePreparedResumeImpl: async ({ controls, selection: pendingSelection, log }) => {
      await resolutionGate.promise;
      if (!controls?.isCurrent()) return null;
      log.push({ event: "resolver:adopted" });
      return pendingSelection;
    }
  });
  const pending = runPaste(harness);
  await settleAsyncWork();
  harness.render().stopJobAnalysis();
  resolutionGate.resolve();
  await pending;
  assert.equal(
    harness.log.some(({ event }) => event === "cancelPreparedResumeResolution"),
    true,
    "Stop explicitly invalidates prepared-resume resolution"
  );
  assert.equal(
    harness.log.some(({ event }) => event === "resolver:adopted"),
    false,
    "a stopped preparation cannot adopt a resume after Stop"
  );
  assert.equal(harness.state[5].activeRun, null, "Stop leaves no orphaned Fit Assessment state");
}

{
  const harness = createHarness();
  const intake = harness.render();
  intake.handleManualJobDescriptionChange(`${POSTING}\nChanged source.`);
  intake.restorePreparedFitAssessment({ localJobText: POSTING, screeningJobText: POSTING });
  assert.equal(
    harness.log.filter(({ event }) => event === "cancelPreparedResumeResolution").length,
    2,
    "manual input replacement and application restore both cancel prepared-resume resolution"
  );
}

{
  const harness = createHarness({ providerStatus: 503 });
  await runPaste(harness);
  assert.equal(harness.requests.filter(({ url }) => url === "/api/job-analysis").length, 1);
  assert.equal(harness.state[5].latestCompleted, null);
  assert.match(harness.state[5].lastError?.message ?? "", /unavailable/i);
  assert.match(
    harness.log.filter(({ event }) => event === "setLinkStatus").at(-1).value,
    /local brief is ready/i,
    "provider HTTP failure falls back locally without losing the preparation"
  );
}

{
  const harness = createHarness({ runFitAssessment: false });
  await runPaste(harness);
  assert.equal(harness.log.filter(({ event }) => event === "resolvePreparedResume").length, 1);
  const request = harness.requests.find(({ url }) => url === "/api/job-analysis");
  assert.equal(request.payload.fitAssessment, undefined, "disabled Fit Assessment sends no resume payload");
  assert.equal(harness.state[5].enabled, false);
}

{
  const harness = createHarness();
  await runPaste(harness);
  const request = harness.requests.find(({ url }) => url === "/api/job-analysis");
  assert.equal(request.payload.fitAssessment.enabled, true);
  assert.equal(request.payload.fitAssessment.resumeText, RESUME);
  assertOrder(
    harness.log,
    ["state:preview", "resolvePreparedResume", "fetch:/api/job-analysis"],
    "resume resolution occurs after local preview and before provider dispatch"
  );
}

{
  const harness = createHarness();
  await runPaste(harness);
  const firstToken = harness.state[5].latestCompleted?.automationToken;
  await runPaste(harness);
  const secondToken = harness.state[5].latestCompleted?.automationToken;
  assert.ok(firstToken);
  assert.ok(secondToken);
  assert.notEqual(
    secondToken,
    firstToken,
    "an identical later Prepare receives a distinct automation receipt"
  );
}

{
  const readinessGate = deferred();
  const requestFieldsRef = {
    current: { provider: "codex-cli", model: "synthetic-model", reasoningEffort: "medium" }
  };
  const harness = createHarness({
    requestFieldsRef,
    readinessImpl: async () => readinessGate.promise
  });
  const pending = runPaste(harness);
  await settleAsyncWork();
  requestFieldsRef.current = {
    provider: "anthropic",
    model: "claude-opus-4-8",
    reasoningEffort: "high"
  };
  harness.render();
  readinessGate.resolve({ ready: true });
  await pending;
  assert.equal(
    harness.requests.some(({ url }) => url === "/api/job-analysis"),
    false,
    "a settings change during readiness invalidates the captured execution context before dispatch"
  );
}

{
  const firstRequestGate = deferred();
  const requestFieldsRef = {
    current: { provider: "codex-cli", model: "synthetic-model", reasoningEffort: "medium" }
  };
  const harness = createHarness({ requestFieldsRef, jobAnalysisGate: firstRequestGate });
  const first = runPaste(harness);
  await settleAsyncWork();
  harness.render();
  const queuedExtension = harness.extension.onItem({ text: POSTING, url: JOB_URL });
  requestFieldsRef.current = {
    provider: "anthropic",
    model: "claude-opus-4-8",
    reasoningEffort: "high"
  };
  harness.render();
  firstRequestGate.resolve();
  await first;
  await queuedExtension;
  const jobRequests = harness.requests.filter(({ url, payload }) => (
    url === "/api/job-analysis" && payload.mode !== "fit-assessment"
  ));
  assert.equal(jobRequests.length, 2);
  assert.equal(
    jobRequests[1].payload.provider,
    "anthropic",
    "a queued extension intake captures provider settings only after it owns the execution lock"
  );
}

console.log("Job intake entry-point characterization: passed");
