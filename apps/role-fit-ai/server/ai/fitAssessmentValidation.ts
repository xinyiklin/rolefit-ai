import {
  parseFitAssessment,
  parseSubmissionAssessment,
  type EligibilityItem,
  type EvidenceReference,
  type FitAssessment,
  type RequirementAssessment,
  type SubmissionAssessment
} from "../../shared/fitAssessmentContract.ts";
import {
  findUngroundedClaimTerm,
  findUngroundedCuratedClaimTerm,
  findUngroundedOutcomeClaim,
  findUngroundedProseProperClaimTerm,
  proseHasUngroundedTerm
} from "./grounding.ts";
import { hasUngroundedNumericClaim } from "./sanitize.ts";

function evidenceSourceText(
  reference: EvidenceReference,
  resumeText: string,
  honestContext: string
): string {
  return reference.source === "RESUME" ? resumeText : honestContext;
}

function normalizedSourceExcerpt(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9.+#']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceExcerptIsGrounded(excerpt: unknown, source: unknown): boolean {
  const normalizedExcerpt = normalizedSourceExcerpt(excerpt);
  const normalizedSource = normalizedSourceExcerpt(source);
  return Boolean(normalizedExcerpt) && normalizedSource.includes(normalizedExcerpt);
}

function evidenceReferencesAreGrounded(
  references: EvidenceReference[],
  resumeText: string,
  honestContext: string
): boolean {
  return references.every((reference) => {
    const source = evidenceSourceText(reference, resumeText, honestContext);
    return sourceExcerptIsGrounded(reference.excerpt, source)
      && !hasUngroundedNumericClaim(reference.excerpt, source);
  });
}

function requirementSourceIsGrounded(
  requirement: Pick<RequirementAssessment | EligibilityItem, "requirement" | "sourceRequirement">,
  jobText: string
): boolean {
  return sourceExcerptIsGrounded(requirement.sourceRequirement, jobText)
    && !findUngroundedClaimTerm(requirement.requirement, requirement.sourceRequirement)
    && !hasUngroundedNumericClaim(requirement.requirement, requirement.sourceRequirement);
}

function candidateEvidenceIsAdverse(value: unknown): boolean {
  const text = normalizedSourceExcerpt(value);
  if (!text) return false;
  const adverseCondition = /\b(?:not authorized|not eligible|cannot|can't|unable|not willing|unwilling)\b/i.test(text)
    || /\b(?:do|does|did) not (?:have|hold|meet|satisfy|possess|qualify)\b/i.test(text)
    || /\b(?:lack|lacks|lacking)\b/i.test(text)
    || /\bno (?:active |valid )?(?:security )?(?:clearance|license|licence|certification|degree|authorization|citizenship|experience)\b/i.test(text)
    || /\bexpired\b/i.test(text);
  if (adverseCondition) return true;
  const sponsorshipExemption = /\b(?:can|able to|eligible to) work without (?:employer )?sponsorship\b/i.test(text)
    || /\bno (?:employer )?sponsorship (?:is )?(?:needed|required)\b/i.test(text)
    || /\b(?:do|does|will) not (?:need|require) (?:employer )?sponsorship\b/i.test(text);
  if (sponsorshipExemption) return false;
  return /\b(?:need|needs|require|requires|required|requiring|seek|seeks|seeking) (?:an? |employer )?sponsorship\b/i.test(text)
    || /\bsponsorship (?:is )?(?:needed|required)\b/i.test(text);
}

function firstDurationYears(value: unknown): number | null {
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20
  };
  const match = String(value ?? "").toLowerCase().match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\+?\s+years?\b/);
  if (!match) return null;
  return /^\d+$/.test(match[1]) ? Number(match[1]) : words[match[1]] ?? null;
}

function mismatchEvidenceIsExplicit(requirement: RequirementAssessment): boolean {
  if (requirement.evidence.some((reference) => candidateEvidenceIsAdverse(reference.excerpt))) return true;
  const requiredYears = firstDurationYears(requirement.sourceRequirement);
  return requiredYears !== null && requirement.evidence.some((reference) => {
    const candidateYears = firstDurationYears(reference.excerpt);
    return candidateYears !== null && candidateYears < requiredYears;
  });
}

function eligibilityEvidenceMatchesStatus(item: EligibilityItem): boolean {
  if (item.status === "UNCERTAIN") return item.evidence.length === 0;
  const adverseEvidence = item.evidence.filter((reference) => candidateEvidenceIsAdverse(reference.excerpt));
  return item.status === "NOT_SATISFIED"
    ? adverseEvidence.length === item.evidence.length
    : adverseEvidence.length === 0;
}

function categoricalVerdictIsConsistent(assessment: FitAssessment): boolean {
  const core = assessment.requirements.filter((requirement) => requirement.importance === "CORE");
  const missingCore = core.filter((requirement) => requirement.coverage === "MISSING").length;
  const uncertainCore = core.filter((requirement) => requirement.coverage === "UNCERTAIN").length;
  const adjacentCore = core.filter((requirement) => requirement.coverage === "ADJACENT").length;
  const everyCoreCovered = core.length > 0 && core.every((requirement) => requirement.coverage === "COVERED");

  if (assessment.verdict === "STRONG_FIT") {
    return missingCore === 0 && uncertainCore === 0 && adjacentCore <= 1;
  }
  if (assessment.verdict === "REASONABLE_FIT") return missingCore <= 1;
  if ((assessment.verdict === "STRETCH" || assessment.verdict === "LIMITED_FIT") && everyCoreCovered) {
    return false;
  }
  return true;
}

function recommendationIsConsistent(assessment: FitAssessment): boolean {
  const { action } = assessment.recommendation;
  if (assessment.eligibility.status === "NOT_SATISFIED") return action === "NOT_RECOMMENDED";
  if (assessment.eligibility.status === "UNCERTAIN") {
    return action === "CONFIRM_ELIGIBILITY" || action === "NOT_RECOMMENDED";
  }
  if (assessment.verdict === "STRONG_FIT" && action === "NOT_RECOMMENDED") return false;
  if ((assessment.verdict === "STRETCH" || assessment.verdict === "LIMITED_FIT") && action === "APPLY") {
    return false;
  }
  return true;
}

function fitSummary(assessment: FitAssessment): string {
  const counts = { COVERED: 0, ADJACENT: 0, MISSING: 0, UNCERTAIN: 0 };
  for (const requirement of assessment.requirements) counts[requirement.coverage] += 1;
  const verdict = assessment.verdict.replace(/_/g, " ").toLowerCase();
  return `${verdict}: ${counts.COVERED} covered, ${counts.ADJACENT} adjacent, ${counts.MISSING} missing, and ${counts.UNCERTAIN} uncertain requirements.`;
}

function verdictReason(assessment: FitAssessment): string {
  const core = assessment.requirements.filter((requirement) => requirement.importance === "CORE");
  const count = (coverage: RequirementAssessment["coverage"]) => core.filter((item) => item.coverage === coverage).length;
  return `Core requirements: ${count("COVERED")} covered, ${count("ADJACENT")} adjacent, ${count("MISSING")} missing, and ${count("UNCERTAIN")} uncertain.`;
}

function requirementExplanation(requirement: RequirementAssessment): string {
  if (requirement.coverage === "COVERED") return "Trusted candidate evidence directly supports this requirement.";
  if (requirement.coverage === "ADJACENT") return "Trusted candidate evidence is related but does not directly establish this requirement.";
  if (requirement.coverage === "MISSING") return "Trusted candidate evidence explicitly establishes a mismatch with this requirement.";
  return "Trusted candidate evidence does not establish whether this requirement is met.";
}

function eligibilityExplanation(item: EligibilityItem): string {
  if (item.status === "SATISFIED") return "Trusted candidate evidence supports this eligibility condition.";
  if (item.status === "NOT_SATISFIED") return "Trusted candidate evidence explicitly says this eligibility condition is not met.";
  return "Trusted candidate evidence does not establish whether this eligibility condition is met.";
}

function recommendationReason(assessment: FitAssessment): string {
  if (assessment.eligibility.status === "NOT_SATISFIED") return "A mandatory eligibility condition is not satisfied.";
  if (assessment.eligibility.status === "UNCERTAIN") return "Confirm the unresolved eligibility condition before applying.";
  if (assessment.recommendation.action === "APPLY") return "The requirement ledger supports applying with the current evidence.";
  if (assessment.recommendation.action === "POLISH_FIRST") return "The candidate evidence is viable, but the application materials should present it more clearly.";
  if (assessment.recommendation.action === "APPLY_SELECTIVELY") return "The requirement ledger contains material gaps to weigh before applying.";
  return "The requirement ledger contains material gaps that make this application a low priority.";
}

function canonicalFitAssessment(assessment: FitAssessment): FitAssessment {
  const requirements = assessment.requirements.map((requirement) => ({
    ...requirement,
    explanation: requirementExplanation(requirement)
  }));
  const eligibilityItems = assessment.eligibility.items.map((item) => ({
    ...item,
    explanation: eligibilityExplanation(item)
  }));
  return {
    ...assessment,
    summary: fitSummary(assessment),
    verdictReason: verdictReason(assessment),
    eligibility: { ...assessment.eligibility, items: eligibilityItems },
    requirements,
    strengths: requirements
      .filter((requirement) => requirement.coverage === "COVERED")
      .map((requirement) => `Covered: ${requirement.requirement}`),
    concerns: requirements
      .filter((requirement) => requirement.coverage !== "COVERED")
      .map((requirement) => `${requirement.coverage === "ADJACENT" ? "Adjacent" : requirement.coverage === "MISSING" ? "Missing" : "Uncertain"}: ${requirement.requirement}`),
    recommendation: {
      action: assessment.recommendation.action,
      reason: recommendationReason(assessment)
    }
  };
}

function advisoryProseIsGrounded(
  value: string,
  jobText: string,
  resumeText: string,
  honestContext: string
): boolean {
  const candidateEvidence = `${resumeText}\n${honestContext}`;
  const candidateLower = candidateEvidence.toLowerCase();
  const jobLower = jobText.toLowerCase();
  return !proseHasUngroundedTerm(value, jobLower, candidateLower)
    && !findUngroundedCuratedClaimTerm(value, candidateEvidence)
    && !findUngroundedProseProperClaimTerm(value, candidateEvidence, jobText)
    && !hasUngroundedNumericClaim(value, candidateEvidence)
    && !findUngroundedOutcomeClaim(value, candidateEvidence, { candidateProse: true });
}

function submissionRequirementExplanation(requirement: RequirementAssessment): string {
  if (requirement.coverage === "COVERED") return "The resume directly presents trusted evidence for this requirement.";
  if (requirement.coverage === "ADJACENT") return "The resume presents related evidence, but the connection is not direct.";
  if (requirement.coverage === "MISSING" && requirement.canSurfaceInResume) {
    return "The resume does not show this qualification, but trusted context supports surfacing it honestly.";
  }
  if (requirement.coverage === "MISSING") return "The resume does not show trusted evidence for this requirement.";
  return "The available evidence does not establish whether the resume can support this requirement.";
}

function submissionSummary(assessment: SubmissionAssessment): string {
  const hidden = assessment.requirementVisibility.filter((item) => item.coverage === "MISSING" || item.coverage === "UNCERTAIN").length;
  const readiness = assessment.readiness.replace(/_/g, " ").toLowerCase();
  return `${readiness}: ${hidden} requirements are missing or unclear, with ${assessment.unsupportedClaims.length} unsupported claims and ${assessment.presentationIssues.length} presentation issues.`;
}

export function validateFitAssessment(
  raw: unknown,
  jobText: string,
  resumeText: string,
  honestContext: string
): FitAssessment | null {
  const assessment = parseFitAssessment(raw);
  if (
    !assessment
    || !categoricalVerdictIsConsistent(assessment)
    || !recommendationIsConsistent(assessment)
  ) return null;

  for (const requirement of assessment.requirements) {
    if (!requirementSourceIsGrounded(requirement, jobText)) return null;
    if (!evidenceReferencesAreGrounded(requirement.evidence, resumeText, honestContext)) return null;
    if (requirement.coverage === "MISSING" && !mismatchEvidenceIsExplicit(requirement)) return null;
  }

  for (const item of assessment.eligibility.items) {
    if (!requirementSourceIsGrounded(item, jobText)) return null;
    if (!evidenceReferencesAreGrounded(item.evidence, resumeText, honestContext)) return null;
    if (!eligibilityEvidenceMatchesStatus(item)) return null;
  }

  return canonicalFitAssessment(assessment);
}

export function validateSubmissionAssessment(
  raw: unknown,
  jobText: string,
  resumeText: string,
  honestContext: string
): SubmissionAssessment | null {
  const assessment = parseSubmissionAssessment(raw);
  if (!assessment || assessment.requirementVisibility.length === 0) return null;

  for (const requirement of assessment.requirementVisibility) {
    if (!requirementSourceIsGrounded(requirement, jobText)) return null;
    if (!evidenceReferencesAreGrounded(requirement.evidence, resumeText, honestContext)) return null;
  }
  if (assessment.unsupportedClaims.some((claim) => !sourceExcerptIsGrounded(claim, resumeText))) return null;
  if (assessment.presentationIssues.some((issue) => !advisoryProseIsGrounded(issue, jobText, resumeText, honestContext))) return null;
  if (assessment.topEdits.some((edit) => !advisoryProseIsGrounded(edit, jobText, resumeText, honestContext))) return null;

  const requirementVisibility = assessment.requirementVisibility.map((requirement) => ({
    ...requirement,
    explanation: submissionRequirementExplanation(requirement)
  }));
  const missingEvidence = requirementVisibility
    .filter((requirement) => requirement.coverage === "MISSING" || requirement.coverage === "UNCERTAIN")
    .map((requirement) => requirement.requirement);
  const canonical = {
    ...assessment,
    requirementVisibility,
    missingEvidence
  };
  if (canonical.readiness === "READY" && (canonical.unsupportedClaims.length > 0 || canonical.missingEvidence.length > 0)) {
    return null;
  }
  if (
    canonical.readiness === "EVIDENCE_NEEDED"
    && canonical.unsupportedClaims.length === 0
    && canonical.missingEvidence.length === 0
  ) return null;

  return { ...canonical, summary: submissionSummary(canonical) };
}
