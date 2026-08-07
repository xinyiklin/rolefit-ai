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
assert.match(fingerprint, /^initial-fit-v1-/, "fingerprint carries the audit contract version");
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
const review = {
  verdict: "REASONABLE FIT",
  verdictReason: "The resume covers the core backend requirements but lacks direct scale evidence.",
  coverage: [{ category: "Required tech", keyword: "Python", status: "covered", where: "Skills and experience" }],
  gaps: [],
  rewrites: [],
  riskFlags: [],
  recommendation: { applyAsIs: false, reason: "Polish the scale evidence.", topEdits: [], coverLetterAngle: "" }
};
const response = {
  preparationId: input.preparationId,
  fingerprint,
  resumeFileName: input.resumeFileName,
  resumeDocumentVersion: input.resumeDocumentVersion,
  score: 76,
  verdict: "REASONABLE FIT",
  verdictReason: review.verdictReason,
  review,
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
assert.deepEqual(parseInitialFitAuditResponse(response, input), response, "valid one-score audit response parses exactly");
assert.equal(parseInitialFitAuditResponse({ ...response, base: 70, tailored: 76 }, input)?.score, 76, "unknown legacy score fields never replace the one score");
assert.equal(parseInitialFitAuditResponse({ ...response, fingerprint: "old" }, input), null, "stale fingerprint is rejected");
assert.equal(parseInitialFitAuditResponse({ ...response, score: 69 }, input), null, "score must agree with the model verdict band");
assert.equal(parseInitialFitAuditResponse({ ...response, review: { ...review, verdict: "STRONG FIT" } }, input), null, "nested review verdict must agree");
assert.equal(parseInitialFitAuditResponse({ ...response, completedAt: "2026-08-07" }, input), null, "completedAt must use the canonical ISO instant form");

console.log("initial fit audit client probes passed");
