import assert from "node:assert/strict";

import {
  AI_STAGE_COPY,
  AI_WORKFLOW_TITLE,
  workflowInputFingerprint,
  workflowRequestIsCurrent
} from "../aiWorkflow.ts";
import { copyAiUsage } from "../aiUsage.ts";
import { ApiError, classifyFailure } from "../failures.ts";

assert.equal(AI_WORKFLOW_TITLE["job-analysis"], "Job analysis", "Job analysis owns its card title");
assert.equal(AI_WORKFLOW_TITLE["resume-polish"], "Resume Polish", "Resume Polish owns its card title");
assert.equal(AI_WORKFLOW_TITLE.cover, "Cover letter", "Cover Letter Polish owns a document-specific card title");
assert.equal(AI_WORKFLOW_TITLE.answers, "Application answers", "answer drafting owns its card title");
assert.equal(AI_STAGE_COPY["job-analysis"].running, "Analyzing job", "progress uses Job analysis vocabulary");
assert.equal(AI_STAGE_COPY.cover.running, "Polishing cover letter", "cover progress matches the Polish action");

const storedUsage = {
  "job-analysis": { source: "ai", provider: "anthropic", model: "analysis-model" },
  "resume-polish": { source: "none" }
};
assert.deepEqual(
  copyAiUsage(storedUsage),
  storedUsage,
  "current AI usage receipts are copied unchanged"
);
assert.notEqual(copyAiUsage(storedUsage), storedUsage, "the copy boundary does not expose stored mutation");

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

console.log("AI workflow eval: 22/22 checks passed");
