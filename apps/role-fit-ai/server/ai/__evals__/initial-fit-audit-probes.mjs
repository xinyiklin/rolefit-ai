import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveInitialFitAuditOutcome } from "../recruiterAudit.ts";
import { buildFitAssessmentPrompts } from "../prompts.ts";

const jobText = [
  "Python and PostgreSQL are required for production backend services.",
  "A bachelor's degree or equivalent experience is required.",
  "Candidates must be authorized to work in the United States."
].join(" ");
const resumeText = "EXPERIENCE\nBuilt production Python services.\nSKILLS\nPython, PostgreSQL";
const honestContext = "Authorized to work in the United States.";
const requirement = {
  id: "req-backend",
  requirement: "Python and PostgreSQL",
  importance: "CORE",
  coverage: "COVERED",
  evidence: [{ source: "RESUME", excerpt: "Python, PostgreSQL" }],
  explanation: "The resume names both required technologies.",
  canSurfaceInResume: false
};
const eligibilityItem = {
  id: "elig-work-auth",
  requirement: "authorized to work in the United States",
  status: "SATISFIED",
  evidence: [{ source: "HONEST_CONTEXT", excerpt: honestContext }],
  explanation: "The candidate explicitly confirmed work authorization."
};
const fitAssessment = {
  verdict: "STRONG_FIT",
  confidence: "HIGH",
  summary: "The candidate directly covers the core backend requirement.",
  verdictReason: "Direct resume evidence covers the central technologies.",
  eligibility: { status: "SATISFIED", items: [eligibilityItem] },
  requirements: [requirement],
  strengths: ["Direct Python and PostgreSQL experience"],
  concerns: [],
  recommendation: { action: "APPLY", reason: "The evidence supports applying." }
};

const valid = resolveInitialFitAuditOutcome({ fitAssessment }, jobText, resumeText, honestContext);
assert.deepEqual(valid, fitAssessment, "Initial Fit returns the categorical assessment");

assert.equal(resolveInitialFitAuditOutcome({ fitAssessment, score: 92 }, jobText, resumeText, honestContext), null, "score-shaped provider envelopes fail closed");

assert.equal(resolveInitialFitAuditOutcome({
  fitAssessment: { ...fitAssessment, requirements: [requirement, requirement] }
}, jobText, resumeText, honestContext), null, "duplicate requirement ids fail closed");

assert.equal(resolveInitialFitAuditOutcome({
  fitAssessment: {
    ...fitAssessment,
    requirements: [{ ...requirement, evidence: [{ source: "RESUME", excerpt: "Led Rust platform migrations." }] }]
  }
}, jobText, resumeText, honestContext), null, "unsupported candidate evidence fails closed");

assert.equal(resolveInitialFitAuditOutcome({
  fitAssessment: {
    ...fitAssessment,
    verdict: "STRONG_FIT",
    requirements: [{ ...requirement, coverage: "MISSING", evidence: [] }]
  }
}, jobText, resumeText, honestContext), null, "strong fit with a missing core requirement fails closed");

assert.equal(resolveInitialFitAuditOutcome({
  fitAssessment: {
    ...fitAssessment,
    eligibility: {
      status: "NOT_SATISFIED",
      items: [{ ...eligibilityItem, status: "NOT_SATISFIED" }]
    }
  }
}, jobText, resumeText, honestContext), null, "failed eligibility needs explicitly negative evidence");

const explicitFailureContext = "I am not authorized to work in the United States.";
const explicitFailure = resolveInitialFitAuditOutcome({
  fitAssessment: {
    ...fitAssessment,
    verdict: "LIMITED_FIT",
    eligibility: {
      status: "NOT_SATISFIED",
      items: [{
        ...eligibilityItem,
        status: "NOT_SATISFIED",
        evidence: [{ source: "HONEST_CONTEXT", excerpt: explicitFailureContext }],
        explanation: "The candidate explicitly says the condition is not met."
      }]
    },
    recommendation: { action: "NOT_RECOMMENDED", reason: "A mandatory condition is not satisfied." }
  }
}, jobText, resumeText, explicitFailureContext);
assert.equal(explicitFailure?.eligibility.status, "NOT_SATISFIED", "explicit failed eligibility is accepted");

const uncertain = resolveInitialFitAuditOutcome({
  fitAssessment: {
    ...fitAssessment,
    verdict: "REASONABLE_FIT",
    confidence: "LOW",
    eligibility: {
      status: "UNCERTAIN",
      items: [{
        id: eligibilityItem.id,
        requirement: eligibilityItem.requirement,
        status: "UNCERTAIN",
        evidence: [],
        explanation: "The trusted candidate evidence does not address work authorization."
      }]
    },
    recommendation: { action: "CONFIRM_ELIGIBILITY", reason: "Confirm work authorization before applying." }
  }
}, jobText, resumeText, "");
assert.equal(uncertain?.eligibility.status, "UNCERTAIN", "omitted eligibility evidence stays uncertain");

const prompts = buildFitAssessmentPrompts({
  jobText,
  resumeText,
  honestContext,
  customInstructions: ""
});
assert.match(prompts.userPrompt, /Missing resume text does not prove/i);
assert.match(prompts.userPrompt, /degree or equivalent experience/i);
assert.match(prompts.userPrompt, /Confidence describes evidence completeness/i);
assert.match(prompts.userPrompt, /Do not produce a numerical score/i);
assert.doesNotMatch(prompts.userPrompt, /"(?:score|aiScore|baseScore|tailoredScore)"\s*:/i);

const routeSource = readFileSync(new URL("../fitAudit.ts", import.meta.url), "utf8");
assert.match(routeSource, /assessment: outcome/, "the Initial Fit route returns the canonical assessment");
assert.doesNotMatch(routeSource, /score: outcome|review: outcome|aiScore:/, "the Initial Fit route exposes no score contract");
assert.match(routeSource, /resolveReviewOnlyProviderRequest\(body\)/, "Initial Fit reuses the Recruiter Audit provider settings");

console.log("initial fit audit server probes passed");
