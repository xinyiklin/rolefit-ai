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
  sourceRequirement: "Python and PostgreSQL are required for production backend services.",
  importance: "CORE",
  coverage: "COVERED",
  evidence: [{ source: "RESUME", excerpt: "Python, PostgreSQL" }],
  explanation: "The resume names both required technologies.",
  canSurfaceInResume: false
};
const eligibilityItem = {
  id: "elig-work-auth",
  requirement: "authorized to work in the United States",
  sourceRequirement: "Candidates must be authorized to work in the United States.",
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
assert.equal(valid?.verdict, fitAssessment.verdict, "Initial Fit returns the categorical assessment");
assert.deepEqual(valid?.strengths, ["Covered: Python and PostgreSQL"], "strengths are derived from the grounded requirement ledger");
assert.doesNotMatch(valid?.summary ?? "", /candidate directly/i, "model-authored summary prose does not reach the user");
assert.doesNotMatch(valid?.verdictReason ?? "", /central technologies/i, "verdict reasons are derived from the grounded ledger");
assert.doesNotMatch(valid?.requirements[0]?.explanation ?? "", /names both/i, "requirement explanations are derived from validated coverage");
assert.doesNotMatch(valid?.eligibility.items[0]?.explanation ?? "", /explicitly confirmed/i, "eligibility explanations are derived from validated status");
assert.notEqual(valid?.recommendation.reason, fitAssessment.recommendation.reason, "recommendation reasons are derived from validated action and eligibility");

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
    requirements: [{ ...requirement, evidence: [{ source: "RESUME", excerpt: "Python, PostgreSQL, Kubernetes" }] }]
  }
}, jobText, resumeText, honestContext), null, "a one-token technology insertion invalidates otherwise grounded evidence");

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
    verdict: "STRONG_FIT",
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

const invertedFailure = resolveInitialFitAuditOutcome({
  fitAssessment: {
    ...fitAssessment,
    verdict: "STRONG_FIT",
    eligibility: {
      status: "NOT_SATISFIED",
      items: [{
        ...eligibilityItem,
        status: "NOT_SATISFIED",
        evidence: [{ source: "HONEST_CONTEXT", excerpt: "Not authorized to work in the United States." }]
      }]
    },
    recommendation: { action: "NOT_RECOMMENDED", reason: "A mandatory condition is not satisfied." }
  }
}, jobText, resumeText, honestContext);
assert.equal(invertedFailure, null, "eligibility evidence cannot invert the polarity of trusted context");

const sponsorshipContext = "I can work without sponsorship.";
const sponsorshipRequirement = "Candidates must be authorized to work in the United States without employer sponsorship.";
const sponsorshipJobText = `${jobText} ${sponsorshipRequirement}`;
const sponsorshipFailure = resolveInitialFitAuditOutcome({
  fitAssessment: {
    ...fitAssessment,
    verdict: "STRONG_FIT",
    eligibility: {
      status: "NOT_SATISFIED",
      items: [{
        ...eligibilityItem,
        requirement: "work without employer sponsorship",
        sourceRequirement: sponsorshipRequirement,
        status: "NOT_SATISFIED",
        evidence: [{ source: "HONEST_CONTEXT", excerpt: sponsorshipContext }]
      }]
    },
    recommendation: { action: "NOT_RECOMMENDED", reason: "A mandatory condition is not satisfied." }
  }
}, sponsorshipJobText, resumeText, sponsorshipContext);
assert.equal(sponsorshipFailure, null, "without sponsorship is positive eligibility evidence, not a failure marker");

for (const positiveContext of [sponsorshipContext, "No sponsorship is required."]) {
  const satisfied = resolveInitialFitAuditOutcome({
    fitAssessment: {
      ...fitAssessment,
      eligibility: {
        status: "SATISFIED",
        items: [{
          ...eligibilityItem,
          requirement: "work without employer sponsorship",
          sourceRequirement: sponsorshipRequirement,
          evidence: [{ source: "HONEST_CONTEXT", excerpt: positiveContext }]
        }]
      }
    }
  }, sponsorshipJobText, resumeText, positiveContext);
  assert.equal(satisfied?.eligibility.status, "SATISFIED", `${positiveContext} remains positive eligibility evidence`);
}

const relocationContext = "I cannot relocate to Boston.";
const relocationRequirement = "Candidates must be able to relocate to Boston.";
const relocationFailure = resolveInitialFitAuditOutcome({
  fitAssessment: {
    ...fitAssessment,
    eligibility: {
      status: "NOT_SATISFIED",
      items: [{
        ...eligibilityItem,
        requirement: "relocate to Boston",
        sourceRequirement: relocationRequirement,
        status: "NOT_SATISFIED",
        evidence: [{ source: "HONEST_CONTEXT", excerpt: relocationContext }]
      }]
    },
    recommendation: { action: "NOT_RECOMMENDED", reason: "A mandatory condition is not satisfied." }
  }
}, `${jobText} ${relocationRequirement}`, resumeText, relocationContext);
assert.equal(relocationFailure?.eligibility.status, "NOT_SATISFIED", "cannot relocate is accepted as explicit adverse evidence");

const explicitMissingContext = "I do not have production Kubernetes experience.";
const explicitMissingRequirement = {
  ...requirement,
  id: "req-kubernetes",
  requirement: "Production Kubernetes experience",
  sourceRequirement: "Production Kubernetes experience is required.",
  coverage: "MISSING",
  evidence: [{ source: "HONEST_CONTEXT", excerpt: explicitMissingContext }],
  explanation: "The candidate explicitly says this experience is absent."
};
const explicitMissing = resolveInitialFitAuditOutcome({
  fitAssessment: {
    ...fitAssessment,
    verdict: "STRETCH",
    eligibility: { status: "SATISFIED", items: [] },
    requirements: [explicitMissingRequirement],
    strengths: [],
    concerns: ["Production Kubernetes experience is missing."],
    recommendation: { action: "APPLY_SELECTIVELY", reason: "A core requirement is not satisfied." }
  }
}, "Production Kubernetes experience is required.", resumeText, explicitMissingContext);
assert.equal(explicitMissing?.requirements[0]?.coverage, "MISSING", "explicit mismatch evidence distinguishes MISSING from UNCERTAIN");

const strongWithFailedEligibility = resolveInitialFitAuditOutcome({
  fitAssessment: {
    ...fitAssessment,
    eligibility: {
      status: "NOT_SATISFIED",
      items: [{
        ...eligibilityItem,
        status: "NOT_SATISFIED",
        evidence: [{ source: "HONEST_CONTEXT", excerpt: explicitFailureContext }]
      }]
    },
    recommendation: { action: "NOT_RECOMMENDED", reason: "Eligibility blocks this otherwise strong fit." }
  }
}, jobText, resumeText, explicitFailureContext);
assert.equal(strongWithFailedEligibility?.verdict, "STRONG_FIT", "failed eligibility does not downgrade candidate fit");

assert.equal(resolveInitialFitAuditOutcome({
  fitAssessment: {
    ...fitAssessment,
    verdict: "LIMITED_FIT",
    recommendation: { action: "NOT_RECOMMENDED", reason: "The candidate has limited fit." }
  }
}, jobText, resumeText, honestContext), null, "an all-covered core ledger cannot validate as limited fit");

assert.equal(resolveInitialFitAuditOutcome({
  fitAssessment: {
    ...fitAssessment,
    recommendation: { action: "NOT_RECOMMENDED", reason: "Do not apply." }
  }
}, jobText, resumeText, honestContext), null, "an eligible strong fit cannot carry a contradictory not-recommended action");

const paraphrasedRequirement = resolveInitialFitAuditOutcome({
  fitAssessment: {
    ...fitAssessment,
    eligibility: { status: "SATISFIED", items: [] },
    requirements: [{
      ...requirement,
      requirement: "Scalable backend development with Python and PostgreSQL",
      sourceRequirement: "Develop and maintain scalable backend services using Python and PostgreSQL."
    }]
  }
}, "Develop and maintain scalable backend services using Python and PostgreSQL.", resumeText, honestContext);
assert.equal(paraphrasedRequirement?.requirements[0]?.requirement, "Scalable backend development with Python and PostgreSQL", "normalized requirement labels are accepted when an exact job excerpt is grounded");

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
        sourceRequirement: eligibilityItem.sourceRequirement,
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
assert.match(prompts.userPrompt, /sourceRequirement/i);
assert.doesNotMatch(prompts.userPrompt, /STRONG_FIT[^\n]*failed eligibility/i);
assert.doesNotMatch(prompts.userPrompt, /"(?:score|aiScore|baseScore|tailoredScore)"\s*:/i);

const routeSource = readFileSync(new URL("../fitAudit.ts", import.meta.url), "utf8");
assert.match(routeSource, /assessment: outcome/, "the Initial Fit route returns the canonical assessment");
assert.doesNotMatch(routeSource, /score: outcome|review: outcome|aiScore:/, "the Initial Fit route exposes no score contract");
assert.match(routeSource, /resolveReviewOnlyProviderRequest\(body\)/, "Initial Fit reuses the Recruiter Audit provider settings");

console.log("initial fit audit server probes passed");
