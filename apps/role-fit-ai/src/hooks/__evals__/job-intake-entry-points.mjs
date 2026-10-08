import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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

const cardBundle = await esbuild.build({
  stdin: {
    contents: `
      import React from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { TaskProgress } from "../../sections/AiWorkflowProgress.tsx";
      export const card = (state, onRetry) => renderToStaticMarkup(
        <TaskProgress stageKey="job-analysis" state={state} onRetry={onRetry} onDismiss={() => {}} />
      );
    `,
    resolveDir: fileURLToPath(new URL(".", import.meta.url)),
    loader: "tsx"
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  write: false,
  logLevel: "silent"
});
const cardModule = { exports: {} };
new Function("require", "module", "exports", cardBundle.outputFiles[0].text)(
  createRequire(import.meta.url), cardModule, cardModule.exports
);
const { card } = cardModule.exports;
assert.match(
  readFileSync(new URL("../../App.tsx", import.meta.url), "utf8"),
  /stageKey="job-analysis"[\s\S]{0,120}?onRetry=\{jobAnalysisRetry\}/,
  "the Job analysis card receives the same Retry the hook returns"
);

// The Answers hook gets its own tiny scheduler so the lock can be checked against the real intake state.
const answersBundle = await esbuild.build({
  stdin: {
    loader: "ts", resolveDir: fileURLToPath(new URL("../../../", import.meta.url)),
    contents: 'export { useApplicationAnswers } from "./src/hooks/useApplicationAnswers.ts"; export { render, unmount } from "react";'
  },
  bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent",
  plugins: [{
    name: "answers-scheduler",
    setup(build) {
      build.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "answers-scheduler" }));
      build.onLoad({ filter: /.*/, namespace: "answers-scheduler" }, () => ({ loader: "js", contents: `
        let slots = [], cursor = 0;
        export function useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (v) => { slots[i] = typeof v === "function" ? v(slots[i]) : v; }]; }
        export function useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; }
        export function useEffect() {}
        export function render(callback) { cursor = 0; return callback(); }
        export function unmount() { slots = []; }` }));
    }
  }]
});
const { useApplicationAnswers, render: renderAnswers } = await import(
  `data:text/javascript;base64,${Buffer.from(answersBundle.outputFiles[0].text).toString("base64")}`
);
const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
// App's own definitions of "a Prepare run is active" and of the Answers lock it drives.
const activeExpression = appSource.match(/const jobPreparationActive =([\s\S]*?);\n/)?.[1];
const lockReason = appSource.match(/editBlocker: jobPreparationActive \? "([^"]+)" : undefined/)?.[1];
assert.ok(activeExpression && lockReason, "App derives the Answers lock from jobPreparationActive");
const prepareActive = ({ isExtractingLink, extensionImportPhase, jobAnalysisProgress, preparationAutomationPending }) =>
  new Function("isExtractingLink", "extensionImportPhase", "jobAnalysisProgress", "preparationAutomationPending", `return (${activeExpression});`)(
    isExtractingLink, extensionImportPhase, jobAnalysisProgress, preparationAutomationPending
  );

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
  fitAssessmentAuto = true,
  readiness = { ready: true },
  beforeProceed = true,
  beforeHandled = false,
  afterProceed = true,
  sourceReplacementChoice = "continue",
  sourceReplacementCurrent = true,
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
  fitAssessmentError,
  selection = { text: RESUME, label: "Synthetic resume" },
  profileLimit = null,
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
    confirmPreparedSourceReplacement: async () => {
      log.push({ event: "source:replacement" });
      return { choice: sourceReplacementChoice, isCurrent: () => sourceReplacementCurrent };
    },
    confirmDuplicateBeforeJobAnalysis: async () => {
      log.push({ event: "duplicate:before" });
      return {
        proceed: beforeProceed,
        note: beforeProceed ? null : "existing application",
        ...(beforeHandled ? { handled: true } : {})
      };
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
    fitAssessmentAuto,
    resolvePreparedResume: async (jobText, controls) => {
      log.push({ event: "resolvePreparedResume", value: jobText });
      return resolvePreparedResumeImpl
        ? resolvePreparedResumeImpl({ jobText, controls, selection, log })
        : selection;
    },
    cancelPreparedResumeResolution: () => log.push({ event: "cancelPreparedResumeResolution" }),
    candidateContext: () => "Authorized to work in the United States.",
    profileLimitMessage: () => profileLimit,
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
          fitAssessment: fitAssessmentError ? null : VALID_FIT,
          ...(fitAssessmentError ? { fitAssessmentError } : {}),
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
        ...(payload.fitAssessment ? {
          fitAssessment: fitAssessmentError ? null : VALID_FIT,
          ...(fitAssessmentError ? { fitAssessmentError } : {})
        } : {})
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

// The card wires onClick to Retry, so React hands the click event to it; no handler may treat that as input.
const clickRetry = (harness) => harness.render().jobAnalysisRetry({ type: "click" });

async function runExtension(harness) {
  harness.render();
  await harness.extension.onItem({ text: POSTING, url: JOB_URL });
}

const sharedCommitOrder = [
  "source:replacement",
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
  const harness = createHarness({ sourceReplacementCurrent: false });
  await runPaste(harness);
  assert.equal(
    harness.log.some(({ event }) => event === "duplicate:before"),
    false,
    "a preparation superseded during source replacement stops before duplicate review"
  );
  assert.equal(
    harness.log.some(({ event }) => event === "fetch:/api/job-analysis"),
    false,
    "a superseded source replacement cannot start provider work"
  );
  assert.equal(
    harness.log.some(({ event }) => event === "setImportedJob"),
    false,
    "a superseded source replacement cannot commit its prepared job"
  );
}

{
  // A declined replacement (for example unsaved Answers work) leaves the committed preparation untouched on every intake path.
  const declineReplacement = async () => ({ choice: "cancel", isCurrent: () => true });
  const untouched = [
    "duplicate:before", "resolvePreparedResume", "fetch:/api/job-analysis", "setImportedJob", "setJobDescription",
    "setResult", "resetCoverWorkflow", "setPipelineAiUsage", "setJobRawText"
  ];
  // Extension and Retry payloads live only in memory, so the card must offer Retry; typed sources can just Prepare again.
  const assertDeclined = (harness, committed, label, retryable) => {
    for (const event of untouched) {
      assert.equal(harness.log.some((entry) => entry.event === event), false, `${label}: a declined replacement never reaches ${event}`);
    }
    assert.equal(harness.state[7], committed, `${label}: the committed preparation is unchanged`);
    const message = committed ? "Kept the current preparation." : "Nothing was prepared.";
    assert.equal(harness.state[3].status, retryable ? "failed" : "stopped", `${label}: the workflow card reports the paused preparation`);
    assert.equal(harness.state[3].errorHeadline, "Preparation paused");
    assert.equal(harness.state[3].error, message);
    assert.equal(harness.log.some((entry) => entry.value === message), true, `${label}: status names what was kept`);
    const html = card(harness.state[3], harness.render().jobAnalysisRetry);
    assert.match(html, /Preparation paused/);
    assert.equal(/Retry<\/button>/.test(html), retryable, `${label}: the visible card ${retryable ? "offers" : "omits"} Retry`);
  };
  for (const [label, run, retryable] of [["URL", runUrl, false], ["paste", runPaste, false], ["extension", runExtension, true]]) {
    const harness = createHarness();
    await run(harness);
    const committed = harness.state[7];
    assert.ok(committed, `${label}: the first Prepare commits a preparation`);
    harness.args.confirmPreparedSourceReplacement = declineReplacement;
    harness.log.length = 0;
    await run(harness);
    assertDeclined(harness, committed, label, retryable);
    if (label === "extension") {
      harness.log.length = 0;
      await clickRetry(harness);
      assertDeclined(harness, committed, "extension Retry", true);
      harness.args.confirmPreparedSourceReplacement = async () => ({ choice: "continue", isCurrent: () => true });
      await clickRetry(harness);
      assert.notEqual(harness.state[7], committed, "extension Retry prepares once the replacement is accepted");
    }

    // A fresh session has nothing to "keep"; the card still reads sensibly.
    const fresh = createHarness();
    fresh.args.confirmPreparedSourceReplacement = declineReplacement;
    await run(fresh);
    assertDeclined(fresh, null, `${label} (fresh session)`, retryable);
  }

  // A keep-current choice is deliberate, so it never turns an extension payload into a failure.
  const kept = createHarness();
  kept.args.confirmPreparedSourceReplacement = async () => ({ choice: "keep-current", isCurrent: () => true });
  await runExtension(kept);
  assert.equal(kept.state[3].status, "stopped");
  assert.equal(kept.state[3].error, "Kept the posting attached to the saved record.");
}

{
  // A first Answers Save during a locked Prepare run publishes update mode, which changes the owner under a run
  // whose request is still current. Nothing else settles that card, so the run must: retryable, lock lifted, B uncommitted.
  // Each site is one place the run re-checks its owner; reverting any of them to a silent stop fails its row.
  const sites = [
    { site: "replacement dialog", held: false, create: () => ({}), configure: (harness, { bumpOwner }) => {
      harness.args.confirmPreparedSourceReplacement = async () => {
        const mine = bumpOwner.current();
        bumpOwner.change();
        return { choice: "continue", isCurrent: () => bumpOwner.current() === mine };
      };
    } },
    { site: "duplicate review before analysis", held: true, create: () => ({}), configure: (harness, { hold }) => {
      harness.args.confirmDuplicateBeforeJobAnalysis = async () => { await hold.promise; return { proceed: true, note: null }; };
    } },
    { site: "resume resolution", held: true,
      create: (hold) => ({ resolvePreparedResumeImpl: async ({ selection }) => { await hold.promise; return selection; } }), configure: () => {} },
    { site: "provider response", held: true, create: (hold) => ({ jobAnalysisGate: hold }), configure: () => {} },
    { site: "duplicate review after analysis", held: true, create: () => ({}), configure: (harness, { hold }) => {
      harness.args.confirmDuplicateAfterJobAnalysis = async () => { await hold.promise; return { proceed: true, note: null }; };
    } }
  ];
  for (const { site, held, create, configure } of sites) {
    for (const [source, run] of [["URL", runUrl], ["paste", runPaste], ["extension", runExtension]]) {
      const label = `${source} / ${site}`;
      const hold = deferred();
      const harness = createHarness(create(hold));
      let ownerVersion = 0;
      let cancelsAtBump = null;
      const bumpOwner = {
        current: () => ownerVersion,
        change: () => {
          cancelsAtBump = harness.log.filter((entry) => entry.event === "cancelPreparedResumeResolution").length;
          ownerVersion += 1; // the Save's publish
        }
      };
      harness.args.confirmPreparedSourceReplacement = async () => {
        const mine = ownerVersion;
        return { choice: "continue", isCurrent: () => ownerVersion === mine };
      };
      configure(harness, { hold, bumpOwner });
      const answersArgs = () => ({
        conversationId: "preparation-0-", resumeText: RESUME, jobDescription: POSTING, rawJobText: POSTING, jobUrl: JOB_URL, candidateContext: "",
        profileLimitMessage: null, customInstructions: "", sourceWarnings: [], aiRequest: { provider: "codex-cli", selectedModel: "synthetic-model", cliReasoningEffort: "low" },
        providerReady: true, providerMessage: "", savedAnswers: [], onSaveAnswer: async () => ({ id: "application-a" }),
        editBlocker: prepareActive({ ...intakeView }) ? lockReason : undefined
      });
      let intakeView = harness.render();
      renderAnswers(() => useApplicationAnswers(answersArgs())).setComposer("Why this role?");
      const answersNow = () => renderAnswers(() => useApplicationAnswers(answersArgs()));

      const pending = run(harness);
      await settleAsyncWork();
      if (held) {
        intakeView = harness.render();
        assert.equal(prepareActive(intakeView), true, `${label}: the run is active while its request is in flight`);
        assert.equal(answersNow().editBlocker, lockReason, `${label}: Answers are locked during the run`);
        answersNow().setComposer("typed during Prepare");
        assert.equal(answersNow().conversation.composer, "Why this role?", `${label}: the locked composer keeps what was typed before Prepare`);
        bumpOwner.change();
        hold.resolve();
      }
      await pending;
      intakeView = harness.render();
      assert.equal(harness.log.some((entry) => entry.event === "setImportedJob"), false, `${label}: job B is never committed`);
      assert.equal(harness.state[7], null, `${label}: no preparation was committed`);
      assert.equal(harness.state[5].activeRun, null, `${label}: the run's Fit request is terminalized`);
      assert.equal(harness.state[2], null, `${label}: the preview is cleared`);
      assert.equal(harness.state[0], false, `${label}: the run is no longer extracting`);
      assert.equal(harness.state[3].status, "failed", `${label}: the card settles instead of staying running`);
      assert.equal(harness.state[3].errorHeadline, "Preparation paused");
      assert.ok(
        harness.log.filter((entry) => entry.event === "cancelPreparedResumeResolution").length > cancelsAtBump,
        `${label}: the unprepared posting's resume recommendation is cancelled`
      );
      assert.match(card(harness.state[3], intakeView.jobAnalysisRetry), /Retry<\/button>/, `${label}: the visible card offers Retry`);
      assert.equal(prepareActive(intakeView), false, `${label}: nothing keeps the run active`);
      assert.equal(answersNow().editBlocker, undefined, `${label}: the Answers lock lifts`);
      answersNow().setComposer("typed after Prepare");
      assert.equal(answersNow().conversation.composer, "typed after Prepare", `${label}: Answers are editable again`);

      harness.args.confirmPreparedSourceReplacement = async () => ({ choice: "continue", isCurrent: () => true });
      harness.log.length = 0;
      await clickRetry(harness);
      assert.ok(harness.state[7], `${label}: Retry prepares job B`);
    }
  }
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
  assert.equal(typeof harness.render().jobAnalysisRetry, "function", "extension intake exposes Retry after settling");
  await clickRetry(harness);
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
  const harness = createHarness({ beforeProceed: false, beforeHandled: true });
  await runPaste(harness);
  assert.equal(harness.log.some(({ event }) => event === "fetch:/api/job-analysis"), false);
  assert.equal(
    harness.log.some(({ event }) => event === "setImportedJob"),
    false,
    "opening the chosen saved record is not overwritten by the incoming raw posting"
  );
  assert.equal(harness.state[3].status, "idle");
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
  assert.equal(harness.state[5].lastError?.message, "No provider configured");
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
  // Retry calls the paste handler with no source, which must prepare what the Prepare posting button shows.
  const harness = createHarness({ jobRawText: `${POSTING}\nCaptured source marker.`, jobDescription: `${POSTING}\nEdited brief marker.` });
  await runPaste(harness);
  const sent = JSON.stringify(harness.requests.find(({ url }) => url === "/api/job-analysis").payload);
  assert.match(sent, /Captured source marker/, "a paste without a source prepares the captured posting");
  assert.doesNotMatch(sent, /Edited brief marker/, "not the edited brief beside it");
}

{
  const harness = createHarness({ providerStatus: 503 });
  await runPaste(harness);
  assert.equal(harness.requests.filter(({ url }) => url === "/api/job-analysis").length, 1);
  assert.equal(harness.state[5].latestCompleted, null);
  assert.equal(harness.state[5].lastError?.message, "Synthetic provider unavailable");
  assert.match(
    harness.log.filter(({ event }) => event === "setLinkStatus").at(-1).value,
    /local brief is ready/i,
    "provider HTTP failure falls back locally without losing the preparation"
  );
}

{
  const harness = createHarness({ fitAssessmentAuto: false });
  await runPaste(harness);
  assert.equal(harness.log.filter(({ event }) => event === "resolvePreparedResume").length, 1);
  const request = harness.requests.find(({ url }) => url === "/api/job-analysis");
  assert.equal(request.payload.fitAssessment, undefined, "automatic Fit Assessment off sends no resume payload");
  const fitRequests = () => harness.requests.filter(({ payload }) => payload.mode === "fit-assessment");
  assert.equal(fitRequests().length, 0, "Prepare makes no Fit request while automatic assessment is off");
  assert.equal(harness.state[5].activeRun, null);
  assert.equal(harness.state[5].lastError, null, "an unassessed preparation is not reported as a failure");
  assert.equal(harness.render().canAssessFit, true, "Assess fit stays available while automatic assessment is off");
  await harness.render().reassessFit();
  assert.equal(fitRequests().length, 1, "an explicit assessment makes exactly one Fit request");
  assert.equal(harness.state[5].latestCompleted?.snapshot.result.verdict, VALID_FIT.verdict);
  assert.equal(
    harness.state[5].latestCompleted?.automationToken,
    undefined,
    "a requested assessment never authorizes automatic Polish"
  );
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

for (const fitProvider of ["codex-cli", "anthropic"]) {
  const fitAssessmentError = "Fit could not verify the cited evidence";
  const harness = createHarness({ fitProvider, fitAssessmentError });
  await runPaste(harness);
  assert.equal(harness.state[5].lastError?.message, fitAssessmentError, "both combined and standalone Fit preserve the rejection reason");
  assert.equal(harness.state[5].latestCompleted, null);
  await harness.render().reassessFit();
  assert.equal(harness.state[5].lastError?.message, fitAssessmentError, "manual retry preserves the rejection reason");
}
{
  const message = "Fit provider setup failed before dispatch";
  const harness = createHarness({
    fitProvider: "anthropic",
    fitReadinessImpl: async () => { throw new Error(message); }
  });
  await runPaste(harness);
  assert.equal(harness.state[5].lastError?.message, message);
  await harness.render().reassessFit();
  assert.equal(harness.state[5].lastError?.message, message);
  assert.equal(harness.requests.filter(({ payload }) => payload.mode === "fit-assessment").length, 0);
}
for (const fitProvider of ["codex-cli", "anthropic"]) {
  const profileLimit = "Your Profile Background is over 12,000 characters. Shorten it in Settings > Background.";
  const harness = createHarness({ fitProvider, profileLimit });
  await runPaste(harness);
  const providerRequests = harness.requests.filter(({ url }) => url === "/api/job-analysis");
  assert.equal(providerRequests.length, 1, "an over-limit Profile still runs Job analysis alone");
  assert.equal(providerRequests[0].payload.fitAssessment, undefined, "Job analysis never carries an over-limit Profile");
  assert.equal(harness.state[5].activeRun, null, "the declined Fit run is settled");
  assert.match(harness.state[5].lastError?.message ?? "", /Profile Background is over 12,000 characters/);
  await harness.render().reassessFit();
  assert.equal(
    harness.requests.filter(({ payload }) => payload.mode === "fit-assessment").length,
    0,
    "reassessing with an over-limit Profile makes no Fit request"
  );
  assert.match(harness.state[5].lastError?.message ?? "", /Profile Background is over 12,000 characters/);
}
console.log("Job intake entry-point characterization: passed");
