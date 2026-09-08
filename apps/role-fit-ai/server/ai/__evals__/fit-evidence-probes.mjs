import assert from "node:assert/strict";
import { FIT_ASSESSMENT_RESPONSE_SCHEMA, sanitizeFitAssessmentResponse } from "../fitAssessment.ts";
import { sanitizeFitAssessment } from "../../../shared/fitAssessmentContract.ts";
import { fitAssessmentMeetsThreshold } from "../../../src/lib/autoPolishPolicy.ts";

function assess(jobText, resumeText, patch = {}) {
  return sanitizeFitAssessmentResponse({
    status: "ASSESSED", verdict: "STRONG",
    matches: [{ jobExcerpt: jobText, candidateSource: "RESUME", candidateExcerpt: resumeText }],
    gaps: [], ...patch
  }, { jobText, resumeText });
}
assert.doesNotMatch(FIT_ASSESSMENT_RESPONSE_SCHEMA, /coverageComplete|requirements|heading|alternatives/);
for (const [job, resume] of [
  ["Build Python services.", "Developed Python services."],
  ["Familiarity with REST APIs.", "Built REST endpoints."],
  ["Experience with ML.", "Built machine learning models."],
  ["Experience with NLP.", "Built natural language processing models."],
  ["Professional or personal Python experience.", "Personal Python experience."],
  ["Experience with Python programming.", "Built Python APIs."],
  ["At least three years of professional Python experience.", "Five years of professional Python experience."],
  ["Production Python deployments.", "Built personal Python deployments in production."],
  ["Rust or Go experience.", "Rust experience."]
]) assert.ok(assess(job, resume), "ordinary evidence does not need literal prose or numeric equality");
for (const [job, resume] of [
  ["Build Python services.", "Played volleyball with friends."],
  ["Build Python services.", "Documented Python services."],
  ["Build Python services.", "Built Go services."],
  ["Python experience.", "I have never used Python."],
  ["Python experience.", "I am currently learning Python."],
  ["Professional Python experience.", "Personal Python experience."],
  ["Professional Python experience required; personal projects do not count.", "Personal Python projects."]
]) assert.equal(assess(job, resume), null, "explicit evidence conflicts remain rejected");
assert.equal(sanitizeFitAssessmentResponse({
  verdict: "STRONG", matches: [{ jobExcerpt: "Python experience.", candidateSource: "RESUME", candidateExcerpt: "used Python" }], gaps: []
}, { jobText: "Python experience.", resumeText: "I have never used Python." }), null);

const transferableGap = { jobExcerpt: "Build Kubernetes deployments.", status: "NOT_SHOWN", relationship: "transferable", candidateSource: "RESUME", candidateExcerpt: "Built Docker deployments." };
const transferable = assess(transferableGap.jobExcerpt, transferableGap.candidateExcerpt, { verdict: "STRETCH", matches: [], gaps: [transferableGap] });
assert.equal(transferable?.verdict, "STRETCH");
assert.equal(transferable.gapDetails?.[0].relationship, "transferable");
assert.equal(sanitizeFitAssessment(transferable)?.verdict, "STRETCH", "browser and saved readers accept the same compact result");
assert.equal(assess(transferableGap.jobExcerpt, transferableGap.candidateExcerpt, { verdict: "STRONG", matches: [], gaps: [transferableGap] }), null);

for (const [relationship, evidence] of [
  ["contradictory", "I have used Python."],
  ["contradictory", "I have never used Kubernetes."],
  ["transferable", "I have never used Python."]
]) {
  const gap = { jobExcerpt: "Python experience.", status: "NOT_SHOWN", relationship, candidateSource: "RESUME", candidateExcerpt: evidence };
  const result = assess(gap.jobExcerpt, evidence, { verdict: "LIMITED", matches: [], gaps: [gap] });
  assert.deepEqual(result?.gaps, [gap.jobExcerpt], "bad optional evidence must preserve the gap");
  assert.equal(result.gapDetails, undefined);
  assert.equal(assess(gap.jobExcerpt, evidence, { verdict: "STRETCH", matches: [], gaps: [gap] }), null, "denied evidence cannot authorize transferable-only Stretch");
}

const insufficient = sanitizeFitAssessmentResponse({ status: "INSUFFICIENT_JOB_INFORMATION" }, { jobText: "Engineer at Synthetic Company. Apply now.", resumeText: "Built Python services." });
assert.equal(insufficient?.status, "INSUFFICIENT_JOB_INFORMATION");
assert.equal(insufficient.verdict, undefined);
assert.equal(fitAssessmentMeetsThreshold(insufficient.verdict, "LIMITED"), false);
assert.equal(sanitizeFitAssessment(insufficient)?.status, "INSUFFICIENT_JOB_INFORMATION");
assert.equal(sanitizeFitAssessment({ verdict: "LIMITED", matches: [], gaps: [] })?.status, "ASSESSED");

const condition = "No sponsorship is available unless you hold a STEM degree.";
const context = "I require sponsorship and hold a STEM degree.";
const eligible = sanitizeFitAssessmentResponse({ verdict: "LIMITED", matches: [], gaps: [], eligibility: { status: "BLOCKED", jobExcerpt: condition, candidateExcerpt: context } }, { jobText: `Build Python services.\n${condition}`, resumeText: "Rust projects.", candidateContext: context });
assert.equal(eligible?.verdict, "LIMITED");
assert.equal(eligible.eligibility?.status, "CHECK", "unproven eligibility does not discard the independent assessment");
console.log("Compact Fit refinement and explicit-conflict probes passed");
