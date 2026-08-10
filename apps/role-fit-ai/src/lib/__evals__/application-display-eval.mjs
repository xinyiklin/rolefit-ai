import assert from "node:assert/strict";

import { fitAssessmentRank, fitAssessmentRunLabel, priorityFor } from "../applicationDisplay.ts";

function application(overrides = {}) {
  return {
    id: "app-1",
    createdAt: "2026-08-08T12:00:00.000Z",
    updatedAt: "2026-08-08T12:00:00.000Z",
    status: "interested",
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

assert.equal(priorityFor(application({ priority: "Low" })), "Low", "an explicit user priority always wins");
assert.equal(priorityFor(application({ status: "interviewing" })), "High", "Interviewing derives High");
assert.equal(priorityFor(application({ status: "offer" })), "High", "Offer derives High");
assert.equal(priorityFor(application()), "Medium", "Strong fit stays advisory and does not raise priority");
assert.equal(
  priorityFor(application({ fitAssessment: { ...application().fitAssessment, result: { ...application().fitAssessment.result, verdict: "LIMITED" } } })),
  "Medium",
  "Limited fit stays advisory and does not lower priority"
);
assert.ok(
  fitAssessmentRank(application()) > fitAssessmentRank(application({
    fitAssessment: { ...application().fitAssessment, result: { ...application().fitAssessment.result, verdict: "LIMITED" } }
  })),
  "Fit Assessment remains available for explicit tracker sorting"
);
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

console.log("application display priority probes: passed");
