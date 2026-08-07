import assert from "node:assert/strict";

import {
  AI_STAGE_COPY,
  workflowCurrentIndex,
  workflowInputFingerprint,
  workflowRequestIsCurrent,
  workflowStageCanAdvance,
  workflowStageIsBlocked,
  workflowStepLabel
} from "../aiWorkflow.ts";
import { canonicalizeAiUsageStageKeys } from "../aiUsage.ts";
import { ApiError, classifyFailure } from "../failures.ts";

const threeStages = (jobAnalysis, tailor, review) => [
  { key: "job-analysis", state: { status: jobAnalysis } },
  { key: "tailor", state: { status: tailor } },
  { key: "review", state: { status: review } }
];

assert.equal(workflowStepLabel(1, 3), "Step 1 of 3", "the workflow exposes the first step count");
assert.equal(workflowCurrentIndex(threeStages("running", "idle", "idle")), 0, "Job analysis is step 1");
assert.equal(workflowCurrentIndex(threeStages("done", "running", "idle")), 1, "Tailor is step 2");
assert.equal(workflowCurrentIndex(threeStages("done", "done", "running")), 2, "Review is step 3");

const failedTailor = threeStages("done", "failed", "idle");
assert.equal(workflowCurrentIndex(failedTailor), 1, "a failed stage remains the current step");
assert.equal(workflowStageIsBlocked(failedTailor, 2), true, "a failed Tailor blocks Review");
assert.equal(workflowStageCanAdvance({ status: "done" }), true, "only a completed stage may advance");
assert.equal(workflowStageCanAdvance({ status: "failed" }), false, "a failed stage cannot advance");
assert.equal(workflowStageCanAdvance({ status: "stopped" }), false, "a stopped stage cannot advance");
assert.equal(AI_STAGE_COPY["job-analysis"].running, "Analyzing job", "progress uses Job analysis vocabulary");

const legacyUsage = {
  distill: { source: "ai", provider: "anthropic", model: "legacy-model" },
  tailor: { source: "none" }
};
assert.deepEqual(
  canonicalizeAiUsageStageKeys(legacyUsage),
  {
    "job-analysis": { source: "ai", provider: "anthropic", model: "legacy-model" },
    tailor: { source: "none" }
  },
  "historical Distill provenance is read as Job analysis"
);
assert.deepEqual(
  canonicalizeAiUsageStageKeys({
    ...legacyUsage,
    "job-analysis": { source: "ai", provider: "openai", model: "canonical-model" }
  }),
  {
    "job-analysis": { source: "ai", provider: "openai", model: "canonical-model" },
    tailor: { source: "none" }
  },
  "canonical Job analysis provenance wins when both generations exist"
);

const unusable = classifyFailure(new ApiError("The job analyzer returned no usable job requirements", 502));
assert.equal(unusable.kind, "parse", "an unusable model response identifies the parsing failure");
assert.equal(unusable.headline, "Parsing error", "the parsing failure has a specific headline");

const rejectedOutput = classifyFailure(new ApiError(
  "The assessment did not satisfy RoleFit's evidence contract.",
  502,
  "output-validation"
));
assert.equal(rejectedOutput.kind, "output-validation", "an explicit semantic output rejection overrides the 502 heuristic");
assert.equal(rejectedOutput.headline, "AI response rejected", "semantic output rejection is not mislabeled as parsing");

const unreachable = classifyFailure(new TypeError("Failed to fetch"));
assert.equal(unreachable.kind, "network", "a network failure is identified specifically");
assert.match(unreachable.detail, /local server/i, "the network message is user-safe");

const rateLimited = classifyFailure(new ApiError("OpenAI rate limit or quota was reached.", 429));
assert.equal(rateLimited.kind, "rate-limit", "provider quota gets its own actionable failure kind");
assert.equal(rateLimited.headline, "Rate limit reached");

const evidenceBlocked = classifyFailure(new ApiError("The proposal did not pass evidence checks.", 422));
assert.equal(evidenceBlocked.kind, "validation", "HTTP 422 is an evidence or validation failure");
assert.equal(evidenceBlocked.headline, "Validation blocked");

const inputBlocked = classifyFailure(new ApiError("Add a job description before continuing.", 400));
assert.equal(inputBlocked.kind, "validation", "plain HTTP 400 input rejection remains a validation failure");
assert.equal(inputBlocked.headline, "Validation blocked", "bad user input keeps the validation headline");

assert.equal(
  classifyFailure(new ApiError("Codex CLI couldn't authenticate (401).", 401)).kind,
  "auth",
  "authentication mapping remains unchanged"
);
assert.equal(
  classifyFailure(new ApiError("Codex CLI timed out before finishing.", 504)).kind,
  "timeout",
  "timeout mapping remains unchanged"
);
assert.equal(
  classifyFailure(new ApiError("The selected provider model is unavailable.", 400)).kind,
  "config",
  "provider configuration mapping remains unchanged"
);

const requestFingerprint = workflowInputFingerprint({ resume: "A", job: "B" });
assert.equal(
  requestFingerprint,
  workflowInputFingerprint({ resume: "A", job: "B" }),
  "equal workflow inputs produce the same request fingerprint"
);
assert.notEqual(
  requestFingerprint,
  workflowInputFingerprint({ resume: "changed", job: "B" }),
  "changed workflow inputs produce a different request fingerprint"
);
assert.equal(
  workflowRequestIsCurrent(3, 3, requestFingerprint, requestFingerprint),
  true,
  "a matching generation and input snapshot remains current"
);
assert.equal(
  workflowRequestIsCurrent(2, 3, requestFingerprint, requestFingerprint),
  false,
  "an older generation cannot commit"
);
assert.equal(
  workflowRequestIsCurrent(3, 3, requestFingerprint, "new-input"),
  false,
  "a response for changed inputs cannot commit"
);
const aborted = new AbortController();
aborted.abort();
assert.equal(
  workflowRequestIsCurrent(3, 3, requestFingerprint, requestFingerprint, aborted.signal),
  false,
  "an aborted request cannot commit"
);

console.log("AI workflow eval: 30/30 checks passed");
