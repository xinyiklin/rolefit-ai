import assert from "node:assert/strict";
import { evaluateFitAssessmentResponse, sanitizeFitAssessmentResponse } from "../fitAssessment.ts";
import { sanitizeJobAnalysis, sanitizePrepareAnalysisResponse } from "../jobAnalysis.ts";

const requirement = "Build Python services.";
const evidence = "Built Python services.";
const response = {
  status: "ASSESSED", verdict: "STRONG",
  matches: [{ jobExcerpt: requirement, candidateSource: "RESUME", candidateExcerpt: evidence }],
  gaps: []
};
for (const bullet of ["", "· ", "·", "• ", "– ", "— ", "▪ ", "○ ", "1. "]) {
  const input = { jobText: `Responsibilities\n${bullet}${requirement}`, resumeText: evidence };
  assert.ok(sanitizeFitAssessmentResponse(response, input), "a list marker is not part of the requirement");
}
for (const suffix of [
  "Benefits\nHealth insurance and paid time off.",
  "About us\nWe build software for local businesses.",
  "Compensation\nCompetitive base pay.",
  "How to apply\nSend your application."
]) {
  const jobText = `Responsibilities\n${requirement}\n${suffix}`;
  assert.ok(sanitizeFitAssessmentResponse(response, { jobText, resumeText: evidence }), "non-requirement sections do not inherit the responsibilities heading");
  assert.ok(sanitizeFitAssessmentResponse({ ...response, verdict: "REASONABLE", gaps: [{ jobExcerpt: "Kubernetes experience required.", status: "NOT_SHOWN" }] }, { jobText: `${jobText}\nRequired qualifications\nKubernetes experience required.`, resumeText: evidence }), "the model can report a later qualification as a gap without a hidden ledger");
}
const input = { jobText: `Responsibilities\n${requirement}`, resumeText: evidence };
for (const [patch, expected] of [
  [{ matches: [{ ...response.matches[0], candidateExcerpt: "Fabricated evidence." }] }, /could not verify/],
  [{ gaps: [{ jobExcerpt: "Fabricated requirement.", status: "NOT_SHOWN" }] }, /could not verify/],
  [{ matches: [] }, /verdict/],
  [{ verdict: "INVALID" }, /unsupported format/]
]) {
  const raw = { ...response, ...patch };
  const standalone = evaluateFitAssessmentResponse(raw, input);
  assert.equal(standalone.fitAssessment, null);
  assert.match(standalone.fitAssessmentError, expected);
  assert.ok(!standalone.fitAssessmentError.includes("Fabricated evidence"));
  const combined = sanitizePrepareAnalysisResponse({ job: { responsibilities: [requirement] }, fitAssessment: raw }, input.jobText, { resumeText: evidence });
  assert.equal(combined.fitAssessmentError, standalone.fitAssessmentError);
  assert.deepEqual(combined.fields.responsibilities, [requirement], "Fit rejection preserves successful job extraction");
}
assert.equal(evaluateFitAssessmentResponse(response, input).fitAssessmentError, undefined);
const cloudInput = {
  jobText: "Foundational understanding of software design, APIs, databases, and cloud environments (AWS, Azure, etc.)",
  resumeText: "Designed APIs and databases and deployed services on AWS."
};
const cloudRaw = { ...response, matches: [{ jobExcerpt: cloudInput.jobText, candidateSource: "RESUME", candidateExcerpt: cloudInput.resumeText }] };
const cloudResult = evaluateFitAssessmentResponse(cloudRaw, cloudInput);
assert.ok(cloudResult.fitAssessment, "illustrative cloud platforms do not require every example");
assert.deepEqual(sanitizePrepareAnalysisResponse({ job: {}, fitAssessment: cloudRaw }, cloudInput.jobText,
  { resumeText: cloudInput.resumeText }).fitAssessment, cloudResult.fitAssessment);

const denied = "I have never used Python.";
const failureInput = { ...input, resumeText: `${evidence}\n${denied}` };
const gap = { jobExcerpt: requirement, status: "NOT_SHOWN" };
for (const [patch, reason] of [
  [{ matches: null }, "invalid-response"],
  [{ matches: [null] }, "invalid-response"],
  [{ matches: Array(4).fill(response.matches[0]) }, "invalid-response"],
  [{ matches: [{ ...response.matches[0], candidateSource: "UNKNOWN" }] }, "invalid-response"],
  [{ matches: [response.matches[0], response.matches[0]] }, "invalid-response"],
  [{ gaps: [gap] }, "invalid-response"],
  [{ matches: [], verdict: "LIMITED", gaps: [gap, gap] }, "invalid-response"],
  [{ gaps: [{ ...gap, status: "UNKNOWN" }] }, "invalid-response"],
  [{ gaps: [{ ...gap, note: "x".repeat(241) }] }, "invalid-response"],
  [{ matches: [{ ...response.matches[0], jobExcerpt: "Build services." }] }, "unverified-evidence"],
  [{ matches: [{ ...response.matches[0], candidateExcerpt: "Built services." }] }, "unverified-evidence"],
  [{ gaps: [{ jobExcerpt: "Invented requirement.", status: "NOT_SHOWN" }] }, "unverified-evidence"],
  [{ matches: [{ ...response.matches[0], candidateExcerpt: denied }] }, "evidence-conflict"],
  [{ matches: [{ ...response.matches[0], candidateExcerpt: "used Python" }] }, "evidence-conflict"],
  [{ eligibility: { status: "UNKNOWN" } }, "invalid-response"],
  [{ eligibility: { status: "CHECK", jobExcerpt: "Invented condition." } }, "unverified-evidence"],
  [{ eligibility: { status: "BLOCKED", jobExcerpt: requirement, candidateExcerpt: "Invented context." } }, "unverified-evidence"]
]) {
  const raw = { ...response, ...patch };
  const reasons = [];
  assert.equal(sanitizeFitAssessmentResponse(raw, failureInput, (failure) => reasons.push(failure)), null);
  assert.deepEqual(reasons, [reason], "each rejection reports one precise category");
  const standalone = evaluateFitAssessmentResponse(raw, failureInput);
  const expectedMessage = reason === "invalid-response" ? /unsupported format/
    : reason === "evidence-conflict" ? /evidence conflict/ : /could not verify/;
  assert.match(standalone.fitAssessmentError, expectedMessage);
  for (const privateText of [requirement, evidence, denied, "Invented"])
    assert.ok(!standalone.fitAssessmentError.includes(privateText), "failure copy must not expose source/provider text");
  const combined = sanitizePrepareAnalysisResponse({ job: { responsibilities: [requirement] }, fitAssessment: raw },
    failureInput.jobText, { resumeText: failureInput.resumeText });
  assert.equal(combined.fitAssessment, null);
  assert.equal(combined.fitAssessmentError, standalone.fitAssessmentError);
  assert.deepEqual(combined.fields.responsibilities, [requirement]);
}

const benefits = "Health insurance and paid time off.";
for (const field of ["responsibilities", "requiredQualifications", "preferredQualifications"]) {
  const extracted = sanitizeJobAnalysis({ [field]: [benefits] }, `${input.jobText}\nBenefits\n${benefits}`);
  assert.deepEqual(extracted[field], [benefits], "heading-only classification is advisory, not a second classifier");
  assert.equal(extracted.conditionIssues[0]?.sourceExcerpt, benefits);
}
const explicit = "Python experience is required.";
assert.deepEqual(sanitizeJobAnalysis({ requiredQualifications: [explicit] }, `Benefits\n${explicit}`).requiredQualifications, [explicit]);
const workAuth = "We do not offer visa sponsorship.";
assert.equal(sanitizeJobAnalysis({ workAuth }, `Benefits\n${workAuth}`).workAuth, workAuth);
assert.ok(sanitizeFitAssessmentResponse(response, { ...input, jobText: `Benefits\n${benefits}\nAbout the role\n${requirement}` }));
console.log("Fit posting format, section-boundary and rejection-reason probes passed");
