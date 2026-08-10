import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const bundled = await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../../lib/fitAssessmentLifecycle.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent"
});
const {
  beginFitAssessmentRun,
  completeFitAssessmentRun,
  consumeFitAssessmentAutomationToken,
  createFitAssessmentProvenance,
  dispatchFitAssessment,
  emptyFitAssessmentState,
  failFitAssessmentRun,
  fitAssessmentMayTriggerAutoPolish,
  fitAssessmentLatestSnapshot,
  fitAssessmentProvenanceChanges,
  fitAssessmentProvenanceIsStale,
  fitAssessmentRequestFingerprint,
  fitAssessmentCanRun,
  restoredFitAssessmentState,
  setFitAssessmentEnabled
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
  fitAssessmentRequestFingerprint(rawPosting, request, aiRequest),
  fitAssessmentRequestFingerprint(rawPostingWithDifferentUnselectedWork, request, aiRequest),
  "the complete provider screening text participates in request identity"
);
assert.equal(
  fitAssessmentRequestFingerprint(rawPosting, request, aiRequest),
  fitAssessmentRequestFingerprint(rawPosting, { ...request, resumeLabel: "Renamed file" }, aiRequest),
  "friendly file labels do not invalidate identical screening inputs"
);
assert.notEqual(
  fitAssessmentRequestFingerprint(rawPosting, request, aiRequest),
  fitAssessmentRequestFingerprint(rawPosting, request, { ...aiRequest, model: "claude-opus-4-6" }),
  "provider model changes participate in request identity"
);

const finalPreparedBrief = [
  "Job title:",
  "Software Engineer",
  "Core responsibilities:",
  "- Build reliable JavaScript services.",
  "- Partner with finance."
].join("\n");
const provenance = createFitAssessmentProvenance(rawPosting, request, aiRequest);
assert.deepEqual(
  fitAssessmentProvenanceChanges(
    provenance,
    rawPosting,
    { text: resumeText },
    request.candidateContext,
    aiRequest
  ),
  [],
  "unchanged assessment inputs produce no change receipt"
);
assert.deepEqual(
  fitAssessmentProvenanceChanges(
    provenance,
    rawPosting,
    { text: `${resumeText}Added one grounded resume bullet.` },
    request.candidateContext,
    aiRequest
  ),
  ["resume"],
  "a resume edit is identified without hiding which assessment became historical"
);
assert.deepEqual(
  fitAssessmentProvenanceChanges(
    provenance,
    rawPostingWithDifferentUnselectedWork,
    null,
    "Available in two weeks.",
    { ...aiRequest, reasoningEffort: "xhigh" }
  ),
  ["job", "resume", "candidate-context", "settings"],
  "every changed assessment input is reported in a stable display order"
);
assert.equal(
  fitAssessmentProvenanceIsStale(
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
  fitAssessmentProvenanceIsStale(
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
  fitAssessmentProvenanceIsStale(provenance, rawPosting, null, request.candidateContext, aiRequest),
  true,
  "clearing the authoritative current resume marks the prior assessment out of date"
);
assert.equal(
  fitAssessmentProvenanceIsStale(
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
assert.equal(fitAssessmentCanRun(false, preparedJob), false);
assert.equal(
  fitAssessmentCanRun(true, preparedJob),
  true,
  "re-enabling Fit Assessment restores Retry from the retained prepared-job receipt"
);

const savedSnapshot = {
  result: {
    verdict: "REASONABLE",
    summary: "Your background aligns well, with a few material gaps.",
    matches: [{
      jobExcerpt: "Build reliable JavaScript services.",
      candidateSource: "RESUME",
      candidateExcerpt: "built reliable JavaScript services"
    }],
    gaps: ["Finance domain experience"]
  },
  resumeLabel: "Saved application resume",
  assessedAt: "2026-08-09T12:00:00.000Z"
};
const readyProvenance = createFitAssessmentProvenance(rawPosting, request, aiRequest);
const prepareRunning = beginFitAssessmentRun(emptyFitAssessmentState(true), {
  id: "fit-prepare-1",
  kind: "prepare",
  resumeLabel: "Backend",
  prepareRunId: "prepare-1",
  automationToken: "prepare-automation-1"
});
const prepareReady = completeFitAssessmentRun(prepareRunning, "fit-prepare-1", {
  snapshot: savedSnapshot,
  provenance: readyProvenance
});
assert.equal(
  fitAssessmentMayTriggerAutoPolish(prepareReady)?.automationToken,
  "prepare-automation-1",
  "the first Fit Assessment completed by Prepare may trigger automatic Polish"
);
for (const staleState of [
  { ...prepareReady, enabled: false },
  {
    ...prepareReady,
    latestCompleted: { ...prepareReady.latestCompleted, changes: ["resume"] }
  },
  {
    ...prepareReady,
    latestCompleted: { ...prepareReady.latestCompleted, previousPreparation: true }
  }
]) {
  assert.equal(
    fitAssessmentMayTriggerAutoPolish(staleState),
    null,
    "disabled, changed, and previous-preparation assessments cannot authorize automatic Polish"
  );
}
const reassessing = beginFitAssessmentRun(prepareReady, {
  id: "fit-reassess-1",
  kind: "reassess",
  resumeLabel: "Backend"
});
assert.equal(
  fitAssessmentLatestSnapshot(reassessing),
  savedSnapshot,
  "starting a reassessment keeps the last completed Fit visible and persistable"
);
const failedReassessment = failFitAssessmentRun(reassessing, "fit-reassess-1", {
  resumeLabel: "Backend",
  message: "Synthetic provider failure"
});
assert.equal(
  fitAssessmentLatestSnapshot(failedReassessment),
  savedSnapshot,
  "a failed reassessment never erases the prior completed Fit"
);
assert.equal(
  failedReassessment.lastError?.message,
  "Synthetic provider failure",
  "the failed attempt remains visible beside the durable completion"
);
const samePreparationStale = {
  ...prepareReady,
  latestCompleted: {
    ...prepareReady.latestCompleted,
    changes: ["resume"],
    previousPreparation: false
  }
};
assert.equal(
  fitAssessmentLatestSnapshot(samePreparationStale),
  savedSnapshot,
  "same-preparation input changes retain the latest completed assessment for Apply"
);
const previousPreparation = {
  ...prepareReady,
  latestCompleted: {
    ...prepareReady.latestCompleted,
    changes: ["job"],
    previousPreparation: true
  }
};
assert.equal(
  fitAssessmentLatestSnapshot(previousPreparation),
  null,
  "a completed assessment from another preparation is never persisted onto the new application"
);
const laterReady = completeFitAssessmentRun(
  beginFitAssessmentRun(prepareReady, {
    id: "fit-reassess-2",
    kind: "reassess",
    resumeLabel: "Backend"
  }),
  "fit-reassess-2",
  { snapshot: savedSnapshot, provenance: readyProvenance }
);
assert.equal(
  fitAssessmentMayTriggerAutoPolish(laterReady),
  null,
  "a later reassessment cannot trigger automatic Polish"
);
const consumedPrepare = consumeFitAssessmentAutomationToken(
  prepareReady,
  "prepare-automation-1"
);
assert.equal(
  fitAssessmentMayTriggerAutoPolish(consumedPrepare),
  null,
  "a Prepare automation token is single-use"
);
const disabledWithHistory = setFitAssessmentEnabled(prepareReady, false);
assert.equal(
  fitAssessmentLatestSnapshot(disabledWithHistory),
  savedSnapshot,
  "turning Fit Assessment off retains the last completed snapshot"
);
assert.equal(
  fitAssessmentLatestSnapshot(beginFitAssessmentRun(emptyFitAssessmentState(true), {
    id: "fit-empty",
    kind: "reassess",
    resumeLabel: "Backend"
  })),
  null,
  "an incomplete assessment is never persisted as a completed snapshot"
);
assert.deepEqual(
  restoredFitAssessmentState(true, "prepare-restored", savedSnapshot),
  {
    enabled: true,
    latestCompleted: {
      snapshot: savedSnapshot,
      origin: "saved",
      changes: [],
      previousPreparation: false,
      prepareRunId: "prepare-restored"
    },
    activeRun: null,
    lastError: null
  },
  "opening a prepared application retains its compact assessment as historical, not current automation input"
);
assert.deepEqual(
  restoredFitAssessmentState(true, "prepare-without-fit", undefined),
  {
    enabled: true,
    latestCompleted: null,
    activeRun: null,
    lastError: {
      resumeLabel: "",
      message: "No Fit Assessment is saved for this preparation. Run it against the restored resume."
    }
  },
  "a prepared application without a saved assessment invites a run instead of asking to Prepare again"
);
assert.deepEqual(
  restoredFitAssessmentState(false, "prepare-restored-disabled", savedSnapshot),
  {
    enabled: false,
    latestCompleted: {
      snapshot: savedSnapshot,
      origin: "saved",
      changes: [],
      previousPreparation: false,
      prepareRunId: "prepare-restored-disabled"
    },
    activeRun: null,
    lastError: null
  },
  "turning Fit Assessment off does not erase a restored completed result"
);
assert.equal(
  fitAssessmentMayTriggerAutoPolish(
    restoredFitAssessmentState(true, "prepare-restored-advisory", savedSnapshot)
  ),
  null,
  "historical assessments never authorize automatic Polish"
);

const intakeSource = readFileSync(new URL("../useJobIntake.ts", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const preparedBriefChangeSource = appSource.slice(
  appSource.indexOf("const handlePreparedJobBriefChange"),
  appSource.indexOf("// Per-section Polish choice")
);
const railSource = readFileSync(
  new URL("../../sections/tabs/prepare/PrepareApplicationRail.tsx", import.meta.url),
  "utf8"
);
assert.match(
  intakeSource,
  /function restorePreparedFitAssessment\([\s\S]{0,1600}?commitPreparation\(\{[\s\S]{0,500}?preparedJob,[\s\S]{0,500}?restoredFitAssessmentState\(runFitAssessment, prepareRunId, snapshot\)/,
  "application restore hydrates the hook-owned prepared-job receipt and historical assessment atomically"
);
assert.match(
  intakeSource,
  /completedAssessment\?\.prepareRunId[\s\S]{0,180}?completedAssessment\.prepareRunId !== currentPrepared\.id/,
  "saved and current completions use preparation identity to detect cross-preparation history"
);
assert.match(
  appSource,
  /restorePreparedFitAssessment\(\s*\{\s*localJobText: restoredTailoringText,\s*screeningJobText: restoredSourceText\s*\},\s*app\.fitAssessment,\s*\{\s*url:[\s\S]{0,100}?sourceText: restoredSourceText/,
  "opening a tracked application sends its restored brief, captured posting, saved assessment, and current draft identity to the intake owner"
);
assert.match(
  intakeSource,
  /const draftInputRef = useRef\(\{[\s\S]{0,180}?sourceText: jobRawText\.trim\(\) \|\| jobDescription\.trim\(\)/,
  "draft identity prefers the immutable captured posting over the editable prepared projection"
);
assert.match(
  intakeSource,
  /commitPreparation\(\{\s*id: prepareIdentity\.prepareRunId,\s*draft: \{ url: url\.trim\(\), sourceText: screeningJobText\.trim\(\) \}/,
  "a successful preparation commits its screening source rather than the generated brief"
);
assert.match(
  preparedBriefChangeSource,
  /preparedJobBriefFieldFromText\(field, value\)[\s\S]{0,700}?setJobDescription\(nextTailoringText\)/,
  "structured brief edits update the prepared projection"
);
assert.doesNotMatch(
  preparedBriefChangeSource,
  /setJobRawText/,
  "structured brief edits never replace the captured posting"
);
assert.match(
  intakeSource,
  /function handleManualJobDescriptionChange\(value: string\)[\s\S]{0,500}?setJobRawText\(""\)/,
  "direct source-text replacement clears the captured posting identity"
);
assert.match(
  appSource,
  /fitAssessmentSnapshot:\s*fitAssessmentLatestSnapshot\(fitAssessmentState\)/,
  "Apply includes the latest completed assessment that belongs to the current preparation"
);
assert.match(
  appSource,
  /const pendingToken = fitAssessmentState\.latestCompleted\?\.automationToken;[\s\S]{0,350}?if \(!candidate\) \{[\s\S]{0,250}?acknowledgeFitAutomation\(pendingToken\)/,
  "a stale or previous Prepare result consumes its token as a declined automation decision"
);
assert.match(
  appSource,
  /const coverVariantResolutionPending = Boolean\([\s\S]{0,500}?rankingJobDescription !== jobDescription\.trim\(\)[\s\S]{0,300}?coverLetterVariantRecommendationKeyRef\.current[\s\S]{0,200}?isRankingCoverLetterVariants/,
  "Cover Letter automation sees pending variant resolution synchronously, including the pre-effect input-key mismatch"
);
assert.match(
  appSource,
  /const coverDecision = automaticPolishActionDecision\(\{[\s\S]{0,350}?prerequisitePending: coverVariantResolutionPending[\s\S]{0,650}?const coverSettled = receipt\.coverStarted \|\| coverDecision === "decline";[\s\S]{0,180}?if \(resumeSettled && coverSettled\)/,
  "the Fit token stays pending while a qualified Cover Letter action waits and settles only after start or permanent decline"
);
assert.match(
  appSource,
  /function handleResumePolish\([\s\S]{0,300}?PolishStartReceipt[\s\S]{0,500}?return \{ started: true \};[\s\S]{0,180}?function handleCoverLetterPolish\(\): PolishStartReceipt/,
  "both automatic document actions return an explicit start-boundary receipt"
);
assert.match(
  appSource,
  /useBeforeUnloadGuard\([\s\S]{0,350}?fitAssessmentRequestActive \|\|[\s\S]{0,100}?preparationAutomationPending/,
  "the unload guard covers the pending one-use Prepare automation decision"
);
assert.match(
  intakeSource,
  /async function evaluateFitAssessment\([\s\S]{0,350}?kind = "reassess"/,
  "later and manual assessments default to advisory-only reassessments"
);
assert.match(
  intakeSource,
  /function assessFitForResume\([\s\S]{0,500}?committedPreparationRef\.current[\s\S]{0,500}?committed\.preparedJob\.screeningJobText/,
  "selecting a resume reassesses against the retained captured posting"
);
assert.match(
  intakeSource,
  /function assessFitForResume\([\s\S]{0,500}?committed\.draft\.url !== draftInputRef\.current\.url[\s\S]{0,250}?committed\.draft\.sourceText !== draftInputRef\.current\.sourceText/,
  "a late resume selection cannot reassess a preparation after the visible job draft diverges"
);
assert.doesNotMatch(
  appSource,
  /evaluateFitAssessment/,
  "App cannot bypass the intake owner's captured-posting receipt"
);
assert.match(
  intakeSource,
  /if \(combineFitAssessment\)[\s\S]{0,500}?automationEligible: duplicateAfter\.proceed/,
  "a combined first assessment authorizes automation only after duplicate review proceeds"
);
assert.match(
  intakeSource,
  /if \(duplicateAfter\.proceed\) \{[\s\S]{0,500}?await evaluateFitAssessment\(screeningJobText, fitRequest,[\s\S]{0,300}?automationToken: prepareIdentity\.automationToken/,
  "a separately configured first assessment remains awaited inside its Prepare transaction"
);
assert.match(
  railSource,
  /completedAssessment\?\.origin === "saved" \? "Saved with application"[\s\S]{0,300}?completedAssessment\?\.previousPreparation[\s\S]{0,120}?"Previous preparation"/,
  "Prepare distinguishes restored history from an assessment belonging to a previous preparation"
);
assert.match(
  intakeSource,
  /latestCompleted: \{[\s\S]{0,180}?\.\.\.completedAssessment,[\s\S]{0,180}?changes: fitAssessmentChanges/,
  "an out-of-date assessment retains its prior snapshot with a structured change receipt"
);
assert.match(
  railSource,
  /Changed since assessment[\s\S]{0,500}?completedAssessment\.changes/,
  "Prepare explains why the retained assessment is out of date"
);
assert.match(
  intakeSource,
  /canAssessFit:[\s\S]{0,300}?&& !jobAnalysisBusyRef\.current && !preparationDraftDiverged && fitAssessmentState\.activeRun === null/,
  "Reassess stays disabled while the visible draft diverges from the committed preparation"
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
  const dispatched = await dispatchFitAssessment({
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
  const dispatched = await dispatchFitAssessment({
    preparedJob,
    currentResume: () => null,
    resolvePreparedResume: async (jobText) => {
      resolveCalls.push(jobText);
      return { text: resumeText, label: "Current" };
    },
    candidateContext: () => request.candidateContext,
    onUnavailable: () => assert.fail("a resolved resume must dispatch Fit Assessment"),
    refresh: async (...args) => { refreshCalls.push(args); }
  });
  assert.equal(dispatched, true, "a resolved retry dispatches Fit Assessment");
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

console.log("Fit Assessment lifecycle probes: passed");
