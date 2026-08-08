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

const threeStages = (jobAnalysis, resumePolish, finalCheck) => [
  { key: "job-analysis", state: { status: jobAnalysis } },
  { key: "resume-polish", state: { status: resumePolish } },
  { key: "final-check", state: { status: finalCheck } }
];

assert.equal(workflowStepLabel(1, 3), "Step 1 of 3", "the workflow exposes the first step count");
assert.equal(workflowCurrentIndex(threeStages("running", "idle", "idle")), 0, "Job analysis is step 1");
assert.equal(workflowCurrentIndex(threeStages("done", "running", "idle")), 1, "Resume Polish is step 2");
assert.equal(workflowCurrentIndex(threeStages("done", "done", "running")), 2, "Final Check is step 3");

const failedResumePolish = threeStages("done", "failed", "idle");
assert.equal(workflowCurrentIndex(failedResumePolish), 1, "a failed stage remains the current step");
assert.equal(workflowStageIsBlocked(failedResumePolish, 2), true, "a failed Resume Polish blocks a later stage");
assert.equal(workflowStageCanAdvance({ status: "done" }), true, "only a completed stage may advance");
assert.equal(workflowStageCanAdvance({ status: "failed" }), false, "a failed stage cannot advance");
assert.equal(workflowStageCanAdvance({ status: "stopped" }), false, "a stopped stage cannot advance");
assert.equal(AI_STAGE_COPY["job-analysis"].running, "Analyzing job", "progress uses Job analysis vocabulary");

const legacyUsage = {
  distill: { source: "ai", provider: "anthropic", model: "legacy-model" },
  tailor: { source: "none" },
  review: { source: "ai", provider: "openai", model: "legacy-reviewer" }
};
assert.deepEqual(
  canonicalizeAiUsageStageKeys(legacyUsage),
  {
    "job-analysis": { source: "ai", provider: "anthropic", model: "legacy-model" },
    "resume-polish": { source: "none" },
    "final-check": { source: "ai", provider: "openai", model: "legacy-reviewer" }
  },
  "historical Distill and Tailor provenance use canonical stage names"
);
assert.deepEqual(
  canonicalizeAiUsageStageKeys({
    ...legacyUsage,
    "job-analysis": { source: "ai", provider: "openai", model: "canonical-model" },
    "resume-polish": { source: "ai", provider: "codex-cli", model: "canonical-polish" }
  }),
  {
    "job-analysis": { source: "ai", provider: "openai", model: "canonical-model" },
    "resume-polish": { source: "ai", provider: "codex-cli", model: "canonical-polish" },
    "final-check": { source: "ai", provider: "openai", model: "legacy-reviewer" }
  },
  "canonical stage provenance wins when both generations exist"
);

const unusable = classifyFailure(new ApiError("The job analyzer returned no usable job requirements", 502));
assert.equal(unusable.kind, "parse", "an unusable model response identifies the parsing failure");
assert.equal(unusable.headline, "Parsing error", "the parsing failure has a specific headline");

const unreachable = classifyFailure(new TypeError("Failed to fetch"));
assert.equal(unreachable.kind, "network", "a network failure is identified specifically");
assert.match(unreachable.detail, /local server/i, "the network message is user-safe");

const rateLimited = classifyFailure(new ApiError("OpenAI rate limit or quota was reached.", 429));
assert.equal(rateLimited.kind, "rate-limit", "provider quota gets its own actionable failure kind");
assert.equal(rateLimited.headline, "Rate limit reached");

const evidenceBlocked = classifyFailure(new ApiError("The proposal did not pass evidence checks.", 422));
assert.equal(evidenceBlocked.kind, "validation", "HTTP 422 is an evidence or validation failure");
assert.equal(evidenceBlocked.headline, "Validation blocked");

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

console.log("AI workflow eval: 23/23 checks passed");
