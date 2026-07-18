import assert from "node:assert/strict";

import {
  workflowCurrentIndex,
  workflowInputFingerprint,
  workflowRequestIsCurrent,
  workflowStageCanAdvance,
  workflowStageIsBlocked,
  workflowStepLabel
} from "../aiWorkflow.ts";
import { ApiError, classifyFailure } from "../failures.ts";

const threeStages = (distill, tailor, review) => [
  { key: "distill", state: { status: distill } },
  { key: "tailor", state: { status: tailor } },
  { key: "review", state: { status: review } }
];

assert.equal(workflowStepLabel(1, 3), "Step 1 of 3", "the workflow exposes the first step count");
assert.equal(workflowCurrentIndex(threeStages("running", "idle", "idle")), 0, "Distill is step 1");
assert.equal(workflowCurrentIndex(threeStages("done", "running", "idle")), 1, "Tailor is step 2");
assert.equal(workflowCurrentIndex(threeStages("done", "done", "running")), 2, "Review is step 3");

const failedTailor = threeStages("done", "failed", "idle");
assert.equal(workflowCurrentIndex(failedTailor), 1, "a failed stage remains the current step");
assert.equal(workflowStageIsBlocked(failedTailor, 2), true, "a failed Tailor blocks Review");
assert.equal(workflowStageCanAdvance({ status: "done" }), true, "only a completed stage may advance");
assert.equal(workflowStageCanAdvance({ status: "failed" }), false, "a failed stage cannot advance");
assert.equal(workflowStageCanAdvance({ status: "stopped" }), false, "a stopped stage cannot advance");

const unusable = classifyFailure(new ApiError("The distiller returned no usable job requirements", 502));
assert.equal(unusable.kind, "parse", "an unusable model response identifies the parsing failure");
assert.equal(unusable.headline, "Parsing error", "the parsing failure has a specific headline");

const unreachable = classifyFailure(new TypeError("Failed to fetch"));
assert.equal(unreachable.kind, "network", "a network failure is identified specifically");
assert.match(unreachable.detail, /local server/i, "the network message is user-safe");

const rateLimited = classifyFailure(new ApiError("OpenAI rate limit or quota was reached.", 429));
assert.equal(rateLimited.kind, "rate-limit", "provider quota gets its own actionable failure kind");
assert.equal(rateLimited.headline, "Rate limit reached");

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

console.log("AI workflow eval: 21/21 checks passed");
