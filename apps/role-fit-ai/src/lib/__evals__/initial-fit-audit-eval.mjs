import assert from "node:assert/strict";

import {
  initialFitAuditFingerprint,
  parseInitialFitAuditResponse
} from "../initialFitAudit.ts";

const input = {
  preparationId: "prep-12345678",
  jobText: "Build production Python services with PostgreSQL and reliable tests.",
  resumeFileName: "backend.resume",
  resumeDocumentVersion: "resume-v1-abc",
  resumeText: "EXPERIENCE\nSoftware Engineer\n- Built production Python services.\nSKILLS\nPython, PostgreSQL",
  honestContext: "Authorized to work in the United States.",
  reviewInstructions: "Be strict about production ownership.",
  review: {
    provider: "claude-cli",
    selectedModel: "claude-sonnet-5",
    cliReasoningEffort: "high"
  }
};

const fingerprint = initialFitAuditFingerprint(input);
assert.match(fingerprint, /^initial-fit-[^-]+-[^-]+-[^-]+$/, "fingerprint has one unversioned identity format");
for (const [key, value] of Object.entries({
  jobText: `${input.jobText} Changed.`,
  resumeFileName: "other.resume",
  resumeDocumentVersion: "resume-v2",
  resumeText: `${input.resumeText}\nEDUCATION\nB.S. Computer Science`,
  honestContext: `${input.honestContext} No sponsorship needed.`,
  reviewInstructions: "Different instructions."
})) {
  assert.notEqual(initialFitAuditFingerprint({ ...input, [key]: value }), fingerprint, `${key} invalidates Initial Fit`);
}
assert.notEqual(
  initialFitAuditFingerprint({ ...input, review: { ...input.review, selectedModel: "claude-opus-4-8" } }),
  fingerprint,
  "Review model changes invalidate Initial Fit"
);

const completedAt = "2026-08-07T12:00:00.000Z";
const assessment = {
  verdict: "REASONABLE_FIT",
  confidence: "HIGH",
  summary: "The candidate covers the central backend requirement.",
  verdictReason: "The resume provides direct Python and PostgreSQL evidence.",
  eligibility: { status: "SATISFIED", items: [] },
  requirements: [{
    id: "req-backend",
    requirement: "Python and PostgreSQL",
    sourceRequirement: "Python and PostgreSQL are required.",
    importance: "CORE",
    coverage: "COVERED",
    evidence: [{ source: "RESUME", excerpt: "Python, PostgreSQL" }],
    explanation: "Both technologies appear in the resume.",
    canSurfaceInResume: false
  }],
  strengths: ["Direct backend evidence"],
  concerns: [],
  recommendation: { action: "POLISH_FIRST", reason: "Surface production ownership more clearly." }
};
const response = {
  preparationId: input.preparationId,
  fingerprint,
  resumeFileName: input.resumeFileName,
  resumeDocumentVersion: input.resumeDocumentVersion,
  assessment,
  completedAt,
  usage: {
    source: "ai",
    provider: input.review.provider,
    model: input.review.selectedModel,
    reasoningEffort: input.review.cliReasoningEffort,
    attempts: 1,
    completedAt
  }
};
assert.deepEqual(parseInitialFitAuditResponse(response, input), response, "valid categorical audit response parses exactly");
assert.equal(parseInitialFitAuditResponse({ ...response, score: 76 }, input), null, "old score-shaped responses are invalidated without conversion");
assert.equal(parseInitialFitAuditResponse({ ...response, fingerprint: "old" }, input), null, "stale fingerprint is rejected");
assert.equal(parseInitialFitAuditResponse({ ...response, assessment: { ...assessment, verdict: "MAYBE" } }, input), null, "unknown verdicts fail closed");
assert.equal(parseInitialFitAuditResponse({ ...response, assessment: { ...assessment, requirements: [] } }, input), null, "empty ledgers fail closed");
assert.equal(parseInitialFitAuditResponse({ ...response, completedAt: "2026-08-07" }, input), null, "completedAt must use the canonical ISO instant form");

console.log("initial fit audit client probes passed");
