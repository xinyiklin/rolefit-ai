import assert from "node:assert/strict";

import {
  MODEL_FIT_ASSESSMENT_EXAMPLE,
  MODEL_SUBMISSION_ASSESSMENT_EXAMPLE,
  parseModelFitAssessmentEnvelope,
  parseModelSubmissionAssessmentEnvelope
} from "../assessmentModelOutput.ts";
import {
  buildFitAssessmentPrompts,
  buildSubmissionAssessmentPrompts
} from "../prompts.ts";

const fitExample = structuredClone(MODEL_FIT_ASSESSMENT_EXAMPLE);
const submissionExample = structuredClone(MODEL_SUBMISSION_ASSESSMENT_EXAMPLE);

assert.equal(parseModelFitAssessmentEnvelope(fitExample).ok, true, "the Initial Fit prompt example passes its model-output parser");
assert.equal(parseModelSubmissionAssessmentEnvelope(submissionExample).ok, true, "the submission prompt example passes its model-output parser");

const fitPrompt = buildFitAssessmentPrompts({}).userPrompt;
const submissionPrompt = buildSubmissionAssessmentPrompts({}).userPrompt;
assert.match(fitPrompt, new RegExp(JSON.stringify(MODEL_FIT_ASSESSMENT_EXAMPLE, null, 2).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(submissionPrompt, new RegExp(JSON.stringify(MODEL_SUBMISSION_ASSESSMENT_EXAMPLE, null, 2).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

const oldRedundantFields = structuredClone(fitExample);
Object.assign(oldRedundantFields.fitAssessment, {
  summary: "Ignored",
  verdictReason: "Ignored",
  strengths: ["Ignored"],
  concerns: ["Ignored"]
});
Object.assign(oldRedundantFields.fitAssessment.eligibility, { status: "SATISFIED" });
Object.assign(oldRedundantFields.fitAssessment.eligibility.items[0], {
  id: "model-id",
  requirement: "Ignored",
  explanation: "Ignored"
});
Object.assign(oldRedundantFields.fitAssessment.requirements[0], {
  id: "duplicate-model-id",
  requirement: "Ignored",
  explanation: "Ignored",
  canSurfaceInResume: true
});
Object.assign(oldRedundantFields.fitAssessment.recommendation, { reason: "Ignored" });
const oldFieldResult = parseModelFitAssessmentEnvelope(oldRedundantFields);
assert.equal(oldFieldResult.ok, true, "legacy presentation fields are ignored");
if (oldFieldResult.ok) {
  assert.equal("canSurfaceInResume" in oldFieldResult.value.requirements[0], false, "model surfacing metadata is discarded");
  assert.equal("id" in oldFieldResult.value.requirements[0], false, "model-authored ids are discarded");
}

const forbiddenScore = structuredClone(fitExample);
forbiddenScore.fitAssessment.score = 90;
assert.deepEqual(
  parseModelFitAssessmentEnvelope(forbiddenScore),
  {
    ok: false,
    issue: {
      phase: "shape",
      code: "FORBIDDEN_NUMERICAL_FIELD",
      path: "fitAssessment.score"
    }
  },
  "legacy numerical fit fields fail with a safe code and path"
);

const missingCoverage = structuredClone(submissionExample);
delete missingCoverage.submissionAssessment.requirementVisibility[0].coverage;
assert.deepEqual(
  parseModelSubmissionAssessmentEnvelope(missingCoverage),
  {
    ok: false,
    issue: {
      phase: "shape",
      code: "MISSING_FIELD",
      path: "submissionAssessment.requirementVisibility[0].coverage"
    }
  },
  "missing decision fields fail with a safe code and path"
);

assert.equal(
  parseModelFitAssessmentEnvelope({ fitAssessment: fitExample.fitAssessment, extra: true }).ok,
  false,
  "the exact single-key envelope remains mandatory"
);

console.log("assessment model-output probes passed");
