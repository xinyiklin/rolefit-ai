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
for (const patch of [
  { matches: [{ ...response.matches[0], candidateExcerpt: "Fabricated evidence." }] },
  { gaps: [{ jobExcerpt: "Fabricated requirement.", status: "NOT_SHOWN" }] },
  { matches: [] }
]) {
  const raw = { ...response, ...patch };
  const standalone = evaluateFitAssessmentResponse(raw, input);
  assert.ok(standalone.fitAssessment?.warnings?.length, "content concerns retain usable assessment with warnings");
  assert.equal(standalone.fitAssessmentError, undefined);
  const combined = sanitizePrepareAnalysisResponse({ job: { responsibilities: [requirement] }, fitAssessment: raw }, input.jobText, { resumeText: evidence });
  assert.deepEqual(combined.fitAssessment, standalone.fitAssessment);
  assert.deepEqual(combined.fields.responsibilities, [requirement], "Fit warnings preserve successful job extraction");
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
  [{ matches: [response.matches[0], response.matches[0]] }, "warning"],
  [{ gaps: [gap] }, "warning"],
  [{ matches: [], verdict: "LIMITED", gaps: [gap, gap] }, "warning"],
  [{ gaps: [{ ...gap, status: "UNKNOWN" }] }, "invalid-response"],
  [{ gaps: [{ ...gap, note: "x".repeat(241) }] }, "invalid-response"],
  [{ matches: [{ ...response.matches[0], jobExcerpt: "Build services." }] }, "warning"],
  [{ matches: [{ ...response.matches[0], candidateExcerpt: "Built services." }] }, "warning"],
  [{ gaps: [{ jobExcerpt: "Invented requirement.", status: "NOT_SHOWN" }] }, "warning"],
  [{ matches: [{ ...response.matches[0], candidateExcerpt: denied }] }, "warning"],
  [{ matches: [{ ...response.matches[0], candidateExcerpt: "used Python" }] }, "warning"],
  [{ eligibility: { status: "UNKNOWN" } }, "invalid-response"],
  [{ eligibility: { status: "CHECK", jobExcerpt: "Invented condition." } }, "warning"],
  [{ eligibility: { status: "BLOCKED", jobExcerpt: requirement, candidateExcerpt: "Invented context." } }, "warning"]
]) {
  const raw = { ...response, ...patch };
  const reasons = [];
  const result = sanitizeFitAssessmentResponse(raw, failureInput, (failure) => reasons.push(failure));
  if (reason === "warning") {
    assert.ok(result?.warnings?.length, "evidence checks still detect concern");
    assert.equal(result.verdict, raw.verdict, "warning never rewrites the model conclusion");
    assert.deepEqual(reasons, [], "evidence concern cannot report workflow failure");
    continue;
  }
  assert.equal(result, null);
  assert.deepEqual(reasons, [reason], "each rejection reports one precise category");
  const standalone = evaluateFitAssessmentResponse(raw, failureInput);
  const expectedMessage = /unsupported format/;
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
