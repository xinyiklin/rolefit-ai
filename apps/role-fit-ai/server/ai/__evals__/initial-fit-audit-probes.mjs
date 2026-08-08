import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveInitialFitAuditOutcome as resolveInitialFitAuditResult } from "../recruiterAudit.ts";
import { buildFitAssessmentPrompts } from "../prompts.ts";
import { parseFitAssessment } from "../../../shared/fitAssessmentContract.ts";

function resolveInitialFitAuditOutcome(...args) {
  const result = resolveInitialFitAuditResult(...args);
  return result.status === "ok" ? result.assessment : null;
}

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
assert.deepEqual(
  valid?.strengths,
  ["Covered: Python and PostgreSQL are required for production backend services."],
  "strengths are derived from the canonical job requirement excerpt",
);
assert.doesNotMatch(valid?.summary ?? "", /candidate directly/i, "model-authored summary prose does not reach the user");
assert.doesNotMatch(valid?.verdictReason ?? "", /central technologies/i, "verdict reasons are derived from the grounded ledger");
assert.doesNotMatch(valid?.requirements[0]?.explanation ?? "", /names both/i, "requirement explanations are derived from validated coverage");
assert.doesNotMatch(valid?.eligibility.items[0]?.explanation ?? "", /explicitly confirmed/i, "eligibility explanations are derived from validated status");
assert.notEqual(valid?.recommendation.reason, fitAssessment.recommendation.reason, "recommendation reasons are derived from validated action and eligibility");
assert.match(valid?.requirements[0]?.id ?? "", /^req-[a-z0-9-]+$/, "requirement ids are derived from the source requirement");
assert.match(valid?.eligibility.items[0]?.id ?? "", /^elig-[a-z0-9-]+$/, "eligibility ids are derived from the source requirement");
assert.ok(parseFitAssessment(valid), "the canonical Initial Fit result round-trips through the shared parser");

const visibleInlineMarkedEvidence = resolveInitialFitAuditOutcome({
  fitAssessment: {
    ...fitAssessment,
    eligibility: { items: [] },
    requirements: [{
      ...requirement,
      sourceRequirement: "Python is required.",
      evidence: [{ source: "RESUME", excerpt: "Built production Python services." }]
    }]
  }
}, "Python is required.", "Built <b>production Python</b> services.", "");
assert.equal(
  visibleInlineMarkedEvidence?.requirements[0]?.coverage,
  "COVERED",
  "exact visible evidence remains grounded when the resume source contains engine inline marks"
);

const ignoredAggregate = resolveInitialFitAuditOutcome({
  fitAssessment: {
    ...fitAssessment,
    eligibility: { status: "NOT_SATISFIED", items: [eligibilityItem] }
  }
}, jobText, resumeText, honestContext);
assert.equal(ignoredAggregate?.eligibility.status, "SATISFIED", "aggregate eligibility is derived from item decisions");

const honestKubernetesContext = "I operate production Kubernetes services.";
const surfacedQualification = resolveInitialFitAuditOutcome({
  fitAssessment: {
    ...fitAssessment,
    eligibility: { status: "SATISFIED", items: [] },
    requirements: [{
      ...requirement,
      id: "model-owned-id",
      sourceRequirement: "Production Kubernetes experience is required.",
      importance: "CORE",
      coverage: "COVERED",
      evidence: [{ source: "HONEST_CONTEXT", excerpt: honestKubernetesContext }],
      canSurfaceInResume: false
    }]
  }
}, "Production Kubernetes experience is required.", resumeText, honestKubernetesContext);
assert.equal(surfacedQualification?.requirements[0]?.canSurfaceInResume, true, "positive honest context derives resume surfacing permission");

const ignoredModelSurfacing = resolveInitialFitAuditOutcome({
  fitAssessment: {
    ...fitAssessment,
    requirements: [{ ...requirement, canSurfaceInResume: true }]
  }
}, jobText, resumeText, honestContext);
assert.equal(ignoredModelSurfacing?.requirements[0]?.canSurfaceInResume, false, "model surfacing metadata cannot override resume-only evidence");

assert.equal(resolveInitialFitAuditOutcome({ fitAssessment, score: 92 }, jobText, resumeText, honestContext), null, "score-shaped provider envelopes fail closed");

assert.equal(resolveInitialFitAuditOutcome({
  fitAssessment: { ...fitAssessment, requirements: [requirement, requirement] }
}, jobText, resumeText, honestContext), null, "duplicate source requirements fail closed");

assert.deepEqual(resolveInitialFitAuditResult({
  fitAssessment: { ...fitAssessment, requirements: [requirement, requirement] }
}, jobText, resumeText, honestContext), {
  status: "invalid",
  issue: {
    phase: "consistency",
    code: "DUPLICATE_SOURCE_REQUIREMENT",
    path: "fitAssessment.requirements[1].sourceRequirement"
  }
}, "duplicate source requirements expose only a safe issue code and fixed path");

assert.deepEqual(resolveInitialFitAuditResult({
  fitAssessment: {
    ...fitAssessment,
    requirements: [{ ...requirement, sourceRequirement: "Rust is required." }]
  }
}, jobText, resumeText, honestContext), {
  status: "invalid",
  issue: {
    phase: "grounding",
    code: "SOURCE_REQUIREMENT_NOT_IN_JOB",
    path: "fitAssessment.requirements[0].sourceRequirement"
  }
}, "an ungrounded source requirement reports its fixed field path");

assert.equal(resolveInitialFitAuditOutcome({
  fitAssessment: {
    ...fitAssessment,
    requirements: [{ ...requirement, evidence: [{ source: "RESUME", excerpt: "Led Rust platform migrations." }] }]
  }
}, jobText, resumeText, honestContext), null, "unsupported candidate evidence fails closed");

assert.deepEqual(resolveInitialFitAuditResult({
  fitAssessment: {
    ...fitAssessment,
    requirements: [{ ...requirement, evidence: [{ source: "RESUME", excerpt: "Led Rust platform migrations." }] }]
  }
}, jobText, resumeText, honestContext), {
  status: "invalid",
  issue: {
    phase: "grounding",
    code: "EVIDENCE_NOT_IN_SOURCE",
    path: "fitAssessment.requirements[0].evidence[0].excerpt"
  }
}, "ungrounded candidate evidence reports the exact evidence index without echoing content");

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

assert.deepEqual(resolveInitialFitAuditResult({
  fitAssessment: {
    ...fitAssessment,
    verdict: "LIMITED_FIT"
  }
}, jobText, resumeText, honestContext), {
  status: "invalid",
  issue: {
    phase: "consistency",
    code: "INCONSISTENT_VERDICT",
    path: "fitAssessment.verdict"
  }
}, "verdict contradictions retain a specific safe rejection");

assert.deepEqual(resolveInitialFitAuditResult({
  fitAssessment: {
    ...fitAssessment,
    recommendation: { action: "NOT_RECOMMENDED" }
  }
}, jobText, resumeText, honestContext), {
  status: "invalid",
  issue: {
    phase: "consistency",
    code: "INCONSISTENT_RECOMMENDATION",
    path: "fitAssessment.recommendation.action"
  }
}, "recommendation contradictions retain a specific safe rejection");

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

for (const positiveContext of [
  sponsorshipContext,
  "No sponsorship is required.",
  "No visa sponsorship required.",
  "No work visa sponsorship is needed.",
  "No future sponsorship required.",
  "No employment sponsorship is needed.",
  "Work visa sponsorship is not required.",
  "No sponsorship now or in the future is required.",
  "I don't need sponsorship.",
  "I won't require sponsorship.",
  "I do not currently need sponsorship.",
  "No H-1B sponsorship is required.",
  "No need for sponsorship.",
  "I have no need for sponsorship.",
  "I have no need for visa sponsorship."
]) {
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

for (const adverseContext of [
  "I require visa sponsorship.",
  "I need work visa sponsorship.",
  "I will require future sponsorship.",
  "I seek employment sponsorship.",
  "Work visa sponsorship is required.",
  "I require H-1B sponsorship."
]) {
  const notSatisfied = resolveInitialFitAuditOutcome({
    fitAssessment: {
      ...fitAssessment,
      eligibility: {
        status: "NOT_SATISFIED",
        items: [{
          ...eligibilityItem,
          requirement: "work without employer sponsorship",
          sourceRequirement: sponsorshipRequirement,
          status: "NOT_SATISFIED",
          evidence: [{ source: "HONEST_CONTEXT", excerpt: adverseContext }]
        }]
      },
      recommendation: { action: "NOT_RECOMMENDED", reason: "Sponsorship is required." }
    }
  }, sponsorshipJobText, resumeText, adverseContext);
  assert.equal(notSatisfied?.eligibility.status, "NOT_SATISFIED", `${adverseContext} remains adverse eligibility evidence`);
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
assert.equal(explicitMissing?.requirements[0]?.canSurfaceInResume, false, "adverse honest context never permits resume surfacing");

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
    eligibility: { status: "SATISFIED", items: [eligibilityItem] },
    requirements: [{
      ...requirement,
      id: "req-work-auth-copy",
      requirement: eligibilityItem.requirement,
      sourceRequirement: eligibilityItem.sourceRequirement,
      evidence: eligibilityItem.evidence,
      canSurfaceInResume: true
    }]
  }
}, jobText, resumeText, honestContext), null, "eligibility conditions cannot reappear in the capability ledger");

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

assert.equal(resolveInitialFitAuditOutcome({
  fitAssessment: {
    ...fitAssessment,
    recommendation: { action: "CONFIRM_ELIGIBILITY", reason: "Confirm eligibility." }
  }
}, jobText, resumeText, honestContext), null, "satisfied eligibility cannot recommend confirmation");

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
assert.equal(paraphrasedRequirement?.requirements[0]?.requirement, "Develop and maintain scalable backend services using Python and PostgreSQL.", "display labels derive from the exact job excerpt");

const invertedRequirementLabel = resolveInitialFitAuditOutcome({
  fitAssessment: {
    ...fitAssessment,
    eligibility: { status: "SATISFIED", items: [] },
    requirements: [{
      ...requirement,
      requirement: "Python and PostgreSQL are not required",
      sourceRequirement: "Python and PostgreSQL are required for production backend services."
    }]
  }
}, jobText, resumeText, honestContext);
assert.equal(invertedRequirementLabel?.requirements[0]?.requirement, requirement.sourceRequirement, "model-authored labels cannot reverse source polarity");

function missingYearsOutcome(sourceRequirement, evidenceExcerpt) {
  return resolveInitialFitAuditOutcome({
    fitAssessment: {
      ...fitAssessment,
      verdict: "STRETCH",
      eligibility: { status: "SATISFIED", items: [] },
      requirements: [{
        ...requirement,
        id: "req-years",
        requirement: sourceRequirement,
        sourceRequirement,
        coverage: "MISSING",
        evidence: [{ source: "HONEST_CONTEXT", excerpt: evidenceExcerpt }]
      }],
      strengths: [],
      concerns: ["Experience mismatch."],
      recommendation: { action: "APPLY_SELECTIVELY", reason: "A core requirement is not satisfied." }
    }
  }, sourceRequirement, resumeText, evidenceExcerpt);
}

assert.equal(
  missingYearsOutcome("Candidates need 3–5 years of Python experience.", "I have 4 years of Python experience."),
  null,
  "a candidate inside a required years range is not missing"
);
assert.equal(
  missingYearsOutcome("Candidates need at least 3 years of Python experience.", "I have 2 years of Python experience.")?.requirements[0]?.coverage,
  "MISSING",
  "an unambiguous minimum supports a deterministic years mismatch"
);
assert.equal(
  missingYearsOutcome("Candidates need 3 years of Python experience.", "I have 2 years of Java experience and 5 years of Python experience."),
  null,
  "an unrelated shorter duration cannot manufacture a relevant mismatch"
);
assert.equal(
  missingYearsOutcome("Candidates need 3 years of Python experience.", "I have 2 years of Java experience."),
  null,
  "a lone duration without a requirement anchor remains uncertain"
);
assert.equal(
  missingYearsOutcome("Candidates need at least 3 years of Java experience.", "I have 2 years of JavaScript experience."),
  null,
  "JavaScript duration evidence cannot manufacture a Java mismatch"
);
assert.equal(
  missingYearsOutcome("Candidates need at least 3 years of JavaScript experience.", "I have 2 years of Java experience."),
  null,
  "Java duration evidence cannot manufacture a JavaScript mismatch"
);

const mixedSponsorshipContext = "I do not require sponsorship now, but I will require future sponsorship.";
assert.equal(resolveInitialFitAuditOutcome({
  fitAssessment: {
    ...fitAssessment,
    eligibility: {
      status: "SATISFIED",
      items: [{
        ...eligibilityItem,
        requirement: sponsorshipRequirement,
        sourceRequirement: sponsorshipRequirement,
        evidence: [{ source: "HONEST_CONTEXT", excerpt: mixedSponsorshipContext }]
      }]
    }
  }
}, sponsorshipJobText, resumeText, mixedSponsorshipContext), null, "an adverse sponsorship clause cannot be masked by a positive clause");

function largeFitRoundTrip(count, adjacentFrom = count) {
  const requirements = Array.from({ length: count }, (_, index) => ({
    ...requirement,
    id: `req-large-${index}`,
    requirement: `Python service capability ${index}`,
    sourceRequirement: `Python service capability ${index} is required.`,
    importance: "SUPPORTING",
    coverage: index >= adjacentFrom ? "ADJACENT" : "COVERED",
    evidence: [{ source: "RESUME", excerpt: `Built Python service capability ${index}.` }]
  }));
  const largeJob = requirements.map((item) => item.sourceRequirement).join("\n");
  const largeResume = requirements.map((item) => item.evidence[0].excerpt).join("\n");
  const outcome = resolveInitialFitAuditOutcome({
    fitAssessment: {
      ...fitAssessment,
      verdict: adjacentFrom === count ? "STRONG_FIT" : "STRETCH",
      eligibility: { status: "SATISFIED", items: [] },
      requirements,
      strengths: [],
      concerns: [],
      recommendation: {
        action: adjacentFrom === count ? "APPLY" : "APPLY_SELECTIVELY",
        reason: "Derived from the requirement ledger."
      }
    }
  }, largeJob, largeResume, "");
  return { outcome, reparsed: parseFitAssessment(outcome) };
}

for (const [count, adjacentFrom] of [[17, 17], [17, 0], [40, 20]]) {
  const roundTrip = largeFitRoundTrip(count, adjacentFrom);
  assert.equal(roundTrip.outcome?.requirements.length, count, `${count} requirements survive server validation`);
  assert.equal(roundTrip.reparsed?.requirements.length, count, `${count} requirements survive the client parser`);
}

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
assert.match(prompts.userPrompt, /A different or adjacent skill does not prove MISSING/i);
assert.match(prompts.userPrompt, /otherwise return UNCERTAIN with no evidence/i);
assert.match(prompts.userPrompt, /degree or equivalent experience/i);
assert.match(prompts.userPrompt, /Confidence describes evidence completeness/i);
assert.match(prompts.userPrompt, /Do not produce a numerical score/i);
assert.match(prompts.userPrompt, /sourceRequirement/i);
assert.match(prompts.userPrompt, /Eligibility conditions must appear only under eligibility\.items/i);
assert.doesNotMatch(prompts.userPrompt, /STRONG_FIT[^\n]*failed eligibility/i);
assert.doesNotMatch(prompts.userPrompt, /"(?:score|aiScore|baseScore|tailoredScore)"\s*:/i);

const routeSource = readFileSync(new URL("../fitAudit.ts", import.meta.url), "utf8");
assert.match(routeSource, /assessment: outcome/, "the Initial Fit route returns the canonical assessment");
assert.doesNotMatch(routeSource, /score: outcome|review: outcome|aiScore:/, "the Initial Fit route exposes no score contract");
assert.match(routeSource, /resolveReviewOnlyProviderRequest\(body\)/, "Initial Fit reuses the Recruiter Audit provider settings");
assert.match(routeSource, /failureKind: "output-validation"/, "Initial Fit classifies parseable rejected output explicitly");
assert.match(routeSource, /phase: outcome\.issue\.phase[\s\S]*code: outcome\.issue\.code[\s\S]*path: outcome\.issue\.path/, "Initial Fit logs only the safe validation classification and path");

console.log("initial fit audit server probes passed");
