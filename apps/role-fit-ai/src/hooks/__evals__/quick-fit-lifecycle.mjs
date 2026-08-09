import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const bundled = await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../../lib/quickFitLifecycle.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent"
});
const {
  createQuickFitProvenance,
  dispatchQuickFitRetry,
  quickFitProvenanceIsStale,
  quickFitRequestFingerprint,
  quickFitRetryIsAvailable
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const resumeText = "Software engineer who built reliable JavaScript services for internal operations teams. ".repeat(2);
const request = {
  resumeText,
  resumeLabel: "Backend",
  candidateContext: "Authorized to work in the United States."
};
const aiRequest = { provider: "claude-cli", model: "claude-sonnet-4-6", reasoningEffort: "high" };
const rawPosting = "Software Engineer\nBuild reliable JavaScript services.\nPartner with finance.";
const rawPostingWithDifferentUnselectedWork = `${rawPosting}\nOwn quarterly incident reviews.`;
assert.notEqual(
  quickFitRequestFingerprint(rawPosting, request, aiRequest),
  quickFitRequestFingerprint(rawPostingWithDifferentUnselectedWork, request, aiRequest),
  "the complete provider screening text participates in request identity"
);
assert.equal(
  quickFitRequestFingerprint(rawPosting, request, aiRequest),
  quickFitRequestFingerprint(rawPosting, { ...request, resumeLabel: "Renamed file" }, aiRequest),
  "friendly file labels do not invalidate identical screening inputs"
);
assert.notEqual(
  quickFitRequestFingerprint(rawPosting, request, aiRequest),
  quickFitRequestFingerprint(rawPosting, request, { ...aiRequest, model: "claude-opus-4-6" }),
  "provider model changes participate in request identity"
);

const finalPreparedBrief = [
  "Job title:",
  "Software Engineer",
  "Core responsibilities:",
  "- Build reliable JavaScript services.",
  "- Partner with finance."
].join("\n");
const provenance = createQuickFitProvenance(rawPosting, request, aiRequest);
assert.equal(
  quickFitProvenanceIsStale(
    provenance,
    rawPosting,
    { text: resumeText },
    request.candidateContext,
    aiRequest
  ),
  false,
  "a combined request remains current after the provider returns a different prepared brief"
);
assert.equal(
  quickFitProvenanceIsStale(
    provenance,
    rawPostingWithDifferentUnselectedWork,
    { text: resumeText },
    request.candidateContext,
    aiRequest
  ),
  true,
  "replacing the canonical source posting invalidates the fit"
);
assert.equal(
  quickFitProvenanceIsStale(provenance, rawPosting, null, request.candidateContext, aiRequest),
  true,
  "clearing the authoritative current resume hides the old ready verdict"
);
assert.equal(
  quickFitProvenanceIsStale(
    provenance,
    rawPosting,
    { text: resumeText },
    request.candidateContext,
    { ...aiRequest, reasoningEffort: "xhigh" }
  ),
  true,
  "provider, model, reasoning, and prompt identity control result reuse"
);

const preparedJob = { localJobText: finalPreparedBrief, screeningJobText: rawPosting };
assert.equal(quickFitRetryIsAvailable(false, preparedJob), false);
assert.equal(
  quickFitRetryIsAvailable(true, preparedJob),
  true,
  "re-enabling Initial Fit restores Retry from the retained prepared-job receipt"
);

const unavailableCases = [
  ["starter-only", { resumeOrigin: "starter", currentText: resumeText }],
  ["blank-origin edited", { resumeOrigin: "blank", currentText: resumeText }],
  ["40-79 character stub", { resumeOrigin: "saved", currentText: "x".repeat(60) }]
];
for (const [label, state] of unavailableCases) {
  let refreshCalls = 0;
  const currentResume = state.resumeOrigin === "saved" && state.currentText.length >= 80
    ? { text: state.currentText, label: "Current" }
    : null;
  const dispatched = await dispatchQuickFitRetry({
    preparedJob,
    currentResume: () => currentResume,
    resolvePreparedResume: async () => null,
    candidateContext: () => "",
    onUnavailable: () => undefined,
    refresh: async () => { refreshCalls += 1; }
  });
  assert.equal(dispatched, false, `${label} has no retry request`);
  assert.equal(refreshCalls, 0, `${label} makes no provider call`);
}

{
  const refreshCalls = [];
  const resolveCalls = [];
  const dispatched = await dispatchQuickFitRetry({
    preparedJob,
    currentResume: () => null,
    resolvePreparedResume: async (jobText) => {
      resolveCalls.push(jobText);
      return { text: resumeText, label: "Current" };
    },
    candidateContext: () => request.candidateContext,
    onUnavailable: () => assert.fail("a resolved resume must dispatch Initial Fit"),
    refresh: async (...args) => { refreshCalls.push(args); }
  });
  assert.equal(dispatched, true, "a resolved retry dispatches Initial Fit");
  assert.deepEqual(
    resolveCalls,
    [finalPreparedBrief],
    "retry keeps the local prepared brief only for prepared-resume resolution"
  );
  assert.equal(
    refreshCalls[0]?.[0],
    rawPosting,
    "retry screens the same canonical posting as the combined Prepare request"
  );
}

console.log("Initial Fit lifecycle probes: passed");
