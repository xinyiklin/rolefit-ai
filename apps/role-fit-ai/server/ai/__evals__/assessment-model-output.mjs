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
import { validateSubmissionAssessment } from "../fitAssessmentValidation.ts";
import { parseSubmissionAssessment } from "../../../shared/fitAssessmentContract.ts";

const minimalFit = {
  fitAssessment: {
    verdict: "STRONG_FIT",
    confidence: "HIGH",
    eligibility: { items: [] },
    requirements: [{
      sourceRequirement: "Python is required.",
      importance: "CORE",
      coverage: "COVERED",
      evidence: [{ source: "RESUME", excerpt: "Python" }]
    }],
    recommendation: { action: "APPLY" }
  }
};
const minimalSubmission = {
  submissionAssessment: {
    readiness: "READY",
    requirementVisibility: [{
      sourceRequirement: "Python is required.",
      importance: "CORE",
      coverage: "COVERED",
      evidence: [{ source: "RESUME", excerpt: "Python" }]
    }],
    unsupportedClaims: [],
    presentationIssues: [],
    topEdits: []
  }
};

assert.equal(parseModelFitAssessmentEnvelope(minimalFit).ok, true, "minimal Initial Fit model output is valid");
assert.equal(parseModelSubmissionAssessmentEnvelope(minimalSubmission).ok, true, "minimal Submission Review model output is valid");

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

const oldSubmissionFields = structuredClone(minimalSubmission);
Object.assign(oldSubmissionFields.submissionAssessment, {
  summary: "Ignored model summary",
  missingEvidence: ["Ignored model gap"]
});
Object.assign(oldSubmissionFields.submissionAssessment.requirementVisibility[0], {
  id: "model-id",
  requirement: "Ignored model label",
  explanation: "Ignored model explanation",
  canSurfaceInResume: true
});
const oldSubmissionResult = parseModelSubmissionAssessmentEnvelope(oldSubmissionFields);
assert.equal(oldSubmissionResult.ok, true, "legacy Submission Review presentation fields are ignored");
if (oldSubmissionResult.ok) {
  assert.equal("id" in oldSubmissionResult.value.requirementVisibility[0], false, "submission model ids are discarded");
  assert.equal("canSurfaceInResume" in oldSubmissionResult.value.requirementVisibility[0], false, "submission surfacing metadata is discarded");
  assert.equal("missingEvidence" in oldSubmissionResult.value, false, "model-authored missing-evidence summaries are discarded");
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

const tooManyRequirements = structuredClone(minimalFit);
tooManyRequirements.fitAssessment.requirements = Array.from(
  { length: 41 },
  (_, index) => ({
    ...minimalFit.fitAssessment.requirements[0],
    sourceRequirement: `Python capability ${index} is required.`
  })
);
assert.deepEqual(
  parseModelFitAssessmentEnvelope(tooManyRequirements),
  {
    ok: false,
    issue: { phase: "shape", code: "TOO_MANY_ITEMS", path: "fitAssessment.requirements" }
  },
  "oversized requirement arrays fail with a safe fixed path"
);

const oversizedString = structuredClone(minimalSubmission);
oversizedString.submissionAssessment.requirementVisibility[0].sourceRequirement = "x".repeat(801);
assert.deepEqual(
  parseModelSubmissionAssessmentEnvelope(oversizedString),
  {
    ok: false,
    issue: {
      phase: "shape",
      code: "STRING_TOO_LONG",
      path: "submissionAssessment.requirementVisibility[0].sourceRequirement"
    }
  },
  "oversized strings fail without echoing their contents"
);

assert.equal(
  parseModelSubmissionAssessmentEnvelope({ submissionAssessment: minimalSubmission.submissionAssessment, extra: true }).ok,
  false,
  "Submission Review also requires the exact single-key envelope"
);

function canonicalSubmission(envelope, jobText, resumeText, honestContext = "") {
  const parsed = parseModelSubmissionAssessmentEnvelope(envelope);
  assert.equal(parsed.ok, true, "the submission fixture must pass the model-output parser");
  return parsed.ok
    ? validateSubmissionAssessment(parsed.value, jobText, resumeText, honestContext)
    : parsed;
}

const kubernetesRequirement = "Production Kubernetes experience is required.";
const positiveKubernetesContext = "I operate production Kubernetes services.";
const missingWithHonestContext = {
  submissionAssessment: {
    ...minimalSubmission.submissionAssessment,
    readiness: "REVISIONS_RECOMMENDED",
    requirementVisibility: [{
      sourceRequirement: kubernetesRequirement,
      importance: "CORE",
      coverage: "MISSING",
      evidence: [{ source: "HONEST_CONTEXT", excerpt: positiveKubernetesContext }],
      canSurfaceInResume: false
    }],
    missingEvidence: ["Model-authored value must be ignored"]
  }
};
const surfacedMissing = canonicalSubmission(
  missingWithHonestContext,
  kubernetesRequirement,
  "Technical Skills: Python.",
  positiveKubernetesContext
);
assert.equal(surfacedMissing.ok, true, "grounded missing qualification canonicalizes");
if (surfacedMissing.ok) {
  assert.equal(surfacedMissing.value.requirementVisibility[0].canSurfaceInResume, true, "positive honest context derives surfacing permission");
  assert.deepEqual(surfacedMissing.value.missingEvidence, [kubernetesRequirement], "missingEvidence is derived from the validated ledger");
  assert.ok(parseSubmissionAssessment(surfacedMissing.value), "the canonical Submission Review round-trips through the shared parser");
}

const missingWithoutEvidence = structuredClone(missingWithHonestContext);
missingWithoutEvidence.submissionAssessment.requirementVisibility[0].evidence = [];
missingWithoutEvidence.submissionAssessment.requirementVisibility[0].canSurfaceInResume = true;
const hiddenMissing = canonicalSubmission(
  missingWithoutEvidence,
  kubernetesRequirement,
  "Technical Skills: Python."
);
assert.equal(hiddenMissing.ok && hiddenMissing.value.requirementVisibility[0].canSurfaceInResume, false, "model surfacing metadata cannot authorize a gap without trusted evidence");

for (const [coverage, evidence] of [
  ["COVERED", [{ source: "HONEST_CONTEXT", excerpt: positiveKubernetesContext }]],
  ["ADJACENT", []],
  ["UNCERTAIN", [{ source: "RESUME", excerpt: "Python" }]]
]) {
  const fixture = structuredClone(minimalSubmission);
  fixture.submissionAssessment.readiness = "REVISIONS_RECOMMENDED";
  fixture.submissionAssessment.requirementVisibility[0] = {
    sourceRequirement: kubernetesRequirement,
    importance: "CORE",
    coverage,
    evidence
  };
  assert.deepEqual(
    parseModelSubmissionAssessmentEnvelope(fixture),
    {
      ok: false,
      issue: {
        phase: "consistency",
        code: "INVALID_COVERAGE_EVIDENCE",
        path: "submissionAssessment.requirementVisibility[0].evidence"
      }
    },
    `${coverage} enforces its evidence-source contract`
  );
}

console.log("assessment model-output probes passed");
