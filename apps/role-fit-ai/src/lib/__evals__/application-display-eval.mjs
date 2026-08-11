import assert from "node:assert/strict";

import {
  appFitVerdict,
  applicationActivityDate,
  fitAssessmentRank,
  fitAssessmentRunLabel,
  fitAssessmentVerdictLabel,
  hostLabel,
  safeExternalUrl,
  safeExternalUrls
} from "../applicationDisplay.ts";

function application(overrides = {}) {
  return {
    id: "app-1",
    createdAt: "2026-08-08T12:00:00.000Z",
    updatedAt: "2026-08-08T12:00:00.000Z",
    status: "applied",
    fitAssessment: {
      resumeLabel: "Backend resume",
      result: {
        verdict: "STRONG",
        summary: "Grounded fit summary.",
        matches: [{
          jobExcerpt: "Build reliable backend services.",
          candidateSource: "RESUME",
          candidateExcerpt: "Built reliable backend services."
        }],
        gaps: []
      }
    },
    ...overrides
  };
}

assert.ok(
  fitAssessmentRank(application()) > fitAssessmentRank(application({
    fitAssessment: { ...application().fitAssessment, result: { ...application().fitAssessment.result, verdict: "LIMITED" } }
  })),
  "Fit Assessment remains available for explicit tracker sorting"
);
assert.deepEqual(
  ["LIMITED", "STRETCH", "REASONABLE", "STRONG"].map((verdict) => fitAssessmentVerdictLabel(verdict)),
  ["Limited", "Stretch", "Reasonable", "Strong"],
  "Fit verdict display stays to one canonical word everywhere"
);
assert.equal(appFitVerdict(application())?.label, "Strong");
const assessmentLabel = fitAssessmentRunLabel({
  ...application().fitAssessment,
  assessedAt: "2026-08-08T12:00:00.000Z",
  provider: "codex-cli",
  model: "gpt-5.6-sol",
  reasoningEffort: "medium",
  promptVersion: "fit-assessment-direct-rubric-v1"
});
assert.match(assessmentLabel, /^Last assessed /, "assessment metadata names its completion time");
assert.match(assessmentLabel, /Codex · CLI \(gpt-5\.6-sol\)/, "assessment metadata names its provider and model");
assert.match(assessmentLabel, /medium reasoning/, "assessment metadata names reasoning effort");
assert.match(assessmentLabel, /rubric v1$/, "assessment metadata names the rubric version");

assert.equal(safeExternalUrl(" https://jobs.example.com/role "), "https://jobs.example.com/role");
assert.equal(safeExternalUrl("http://jobs.example.com/role"), "http://jobs.example.com/role");
for (const unsafeUrl of [
  "javascript:alert(1)",
  "data:text/html,unsafe",
  "//jobs.example.com/role",
  "not a URL"
]) {
  assert.equal(safeExternalUrl(unsafeUrl), "", `stored posting URL stays inert: ${unsafeUrl}`);
  assert.equal(hostLabel(unsafeUrl), "", `unsafe posting URL has no clickable host: ${unsafeUrl}`);
}

assert.deepEqual(
  safeExternalUrls([
    " https://jobs.example.com/role ",
    "javascript:alert(1)",
    "https://board.example.com/role",
    "https://jobs.example.com/role"
  ]),
  ["https://jobs.example.com/role", "https://board.example.com/role"],
  "posting provenance keeps only safe, de-duplicated destinations"
);
assert.equal(
  applicationActivityDate(application({
    status: "not_applying",
    notApplyingAt: "2026-08-10T12:00:00.000Z",
    appliedAt: "2026-08-09T12:00:00.000Z"
  })),
  "2026-08-10T12:00:00.000Z",
  "skipped records display their decision date instead of an obsolete application date"
);

console.log("application display probes: passed");
