import {
  parseFitAssessment,
  parseSubmissionAssessment,
  type EvidenceReference,
  type FitAssessment,
  type SubmissionAssessment
} from "../../shared/fitAssessmentContract.ts";
import {
  evidenceIsGrounded,
  gapIsGroundedInJob,
  hasUngroundedNumericClaim
} from "./sanitize.ts";

function evidenceSourceText(
  reference: EvidenceReference,
  resumeText: string,
  honestContext: string
): string {
  return reference.source === "RESUME" ? resumeText : honestContext;
}

function evidenceReferencesAreGrounded(
  references: EvidenceReference[],
  resumeText: string,
  honestContext: string
): boolean {
  return references.every((reference) => {
    const source = evidenceSourceText(reference, resumeText, honestContext);
    return evidenceIsGrounded(reference.excerpt, source)
      && !hasUngroundedNumericClaim(reference.excerpt, source);
  });
}

function explicitlyNegativeEvidence(references: EvidenceReference[]): boolean {
  return references.some((reference) =>
    /\b(?:not|no|cannot|can't|unable|without|lack(?:s|ing)?|requires? sponsorship|needs? sponsorship|expired)\b/i
      .test(reference.excerpt)
  );
}

function categoricalVerdictIsConsistent(assessment: FitAssessment): boolean {
  const missingCore = assessment.requirements.filter(
    (requirement) => requirement.importance === "CORE" && requirement.coverage === "MISSING"
  ).length;
  const adjacentCore = assessment.requirements.filter(
    (requirement) => requirement.importance === "CORE" && requirement.coverage === "ADJACENT"
  ).length;

  if (assessment.verdict === "STRONG_FIT") {
    return assessment.eligibility.status !== "NOT_SATISFIED"
      && missingCore === 0
      && adjacentCore <= 1;
  }
  if (assessment.verdict === "REASONABLE_FIT") return missingCore <= 1;
  return true;
}

export function validateFitAssessment(
  raw: unknown,
  jobText: string,
  resumeText: string,
  honestContext: string
): FitAssessment | null {
  const assessment = parseFitAssessment(raw);
  if (!assessment || !categoricalVerdictIsConsistent(assessment)) return null;

  for (const requirement of assessment.requirements) {
    if (!gapIsGroundedInJob(requirement.requirement, jobText)) return null;
    if (!evidenceReferencesAreGrounded(requirement.evidence, resumeText, honestContext)) return null;
  }

  for (const item of assessment.eligibility.items) {
    if (!gapIsGroundedInJob(item.requirement, jobText)) return null;
    if (!evidenceReferencesAreGrounded(item.evidence, resumeText, honestContext)) return null;
    if (item.status === "NOT_SATISFIED" && !explicitlyNegativeEvidence(item.evidence)) return null;
  }

  return assessment;
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
    if (!gapIsGroundedInJob(requirement.requirement, jobText)) return null;
    if (!evidenceReferencesAreGrounded(requirement.evidence, resumeText, honestContext)) return null;
  }
  if (assessment.unsupportedClaims.some((claim) => !evidenceIsGrounded(claim, resumeText))) return null;
  if (assessment.missingEvidence.some((claim) => !gapIsGroundedInJob(claim, jobText))) return null;
  if (
    assessment.readiness === "EVIDENCE_NEEDED" &&
    assessment.unsupportedClaims.length === 0 &&
    assessment.missingEvidence.length === 0
  ) return null;

  return assessment;
}
