import assert from "node:assert/strict";

import {
  parseFitAssessment,
  parseSubmissionAssessment
} from "../fitAssessmentContract.ts";

const evidence = [{ source: "RESUME", excerpt: "Built and operated Kubernetes services." }];
const requirement = {
  id: "req-kubernetes",
  requirement: "Production Kubernetes experience",
  sourceRequirement: "Production Kubernetes experience is required.",
  importance: "CORE",
  coverage: "COVERED",
  evidence,
  explanation: "The resume provides direct production evidence.",
  canSurfaceInResume: false
};
const eligibilityItem = {
  id: "eligibility-work-auth",
  requirement: "Authorized to work in the United States",
  sourceRequirement: "Candidates must be authorized to work in the United States.",
  status: "SATISFIED",
  evidence: [{ source: "HONEST_CONTEXT", excerpt: "Authorized to work in the United States." }],
  explanation: "The candidate explicitly supplied this fact."
};
const assessment = {
  verdict: "STRONG_FIT",
  confidence: "HIGH",
  summary: "The candidate covers the role's central requirements.",
  verdictReason: "Direct production evidence covers the core requirements.",
  eligibility: { status: "SATISFIED", items: [eligibilityItem] },
  requirements: [requirement],
  strengths: ["Direct Kubernetes ownership"],
  concerns: [],
  recommendation: { action: "APPLY", reason: "The evidence supports applying." }
};

assert.deepEqual(parseFitAssessment(assessment), assessment);
assert.equal(parseFitAssessment({ ...assessment, score: 92 }), null);
assert.equal(parseFitAssessment({ ...assessment, verdict: "DON'T APPLY" }), null);
assert.equal(parseFitAssessment({ ...assessment, requirements: [] }), null);
assert.equal(parseFitAssessment({ ...assessment, requirements: [requirement, requirement] }), null);
assert.equal(parseFitAssessment({
  ...assessment,
  requirements: [{ ...requirement, coverage: "MISSING", evidence: [] }]
}), null);
assert.equal(parseFitAssessment({
  ...assessment,
  requirements: [{ ...requirement, coverage: "UNCERTAIN", evidence }]
}), null);
assert.equal(parseFitAssessment({
  ...assessment,
  eligibility: { status: "SATISFIED", items: [{ ...eligibilityItem, status: "UNCERTAIN", evidence: [] }] }
}), null);
assert.equal(parseFitAssessment({
  ...assessment,
  eligibility: {
    status: "NOT_SATISFIED",
    items: [{ ...eligibilityItem, status: "NOT_SATISFIED", evidence: [] }]
  }
}), null);

const submission = {
  readiness: "READY",
  summary: "The document is ready to submit.",
  requirementVisibility: [requirement],
  unsupportedClaims: [],
  missingEvidence: [],
  presentationIssues: [],
  topEdits: []
};
assert.deepEqual(parseSubmissionAssessment(submission), submission);
assert.equal(parseSubmissionAssessment({ ...submission, tailoredScore: 92 }), null);
assert.equal(parseSubmissionAssessment({ ...submission, readiness: "READY", unsupportedClaims: ["Invented metric"] }), null);
assert.equal(parseSubmissionAssessment({ ...submission, requirementVisibility: [requirement, requirement] }), null);
assert.equal(parseSubmissionAssessment({
  ...submission,
  readiness: "REVISIONS_RECOMMENDED",
  requirementVisibility: [{ ...requirement, coverage: "MISSING", evidence: [], canSurfaceInResume: true }]
}), null);
const surfaceableVisibility = {
  ...requirement,
  coverage: "MISSING",
  evidence: [{ source: "HONEST_CONTEXT", excerpt: "I operate production Kubernetes services." }],
  canSurfaceInResume: true
};
assert.deepEqual(parseSubmissionAssessment({
  ...submission,
  readiness: "REVISIONS_RECOMMENDED",
  requirementVisibility: [surfaceableVisibility]
})?.requirementVisibility[0], surfaceableVisibility);

console.log("Fit assessment contract probes passed.");
