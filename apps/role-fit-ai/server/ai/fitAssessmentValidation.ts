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
  requirement: Pick<RequirementAssessment | EligibilityItem, "sourceRequirement">,
  jobText: string
): boolean {
  return sourceExcerptIsGrounded(requirement.sourceRequirement, jobText);
}

const SPONSORSHIP_WORDS = String.raw`(?:[a-z0-9]+\s+){0,8}sponsorship`;
const SPONSORSHIP_POSITIVE_PATTERNS = [
  new RegExp(String.raw`\bwithout\s+${SPONSORSHIP_WORDS}\b`, "i"),
  new RegExp(String.raw`\bno\s+${SPONSORSHIP_WORDS}(?:\s+[a-z]+){0,8}\s+(?:needed|required)\b`, "i"),
  new RegExp(String.raw`\b(?:do|does|did|will)\s+not\s+(?:[a-z]+\s+){0,3}(?:need|require)\s+${SPONSORSHIP_WORDS}\b`, "i"),
  new RegExp(String.raw`\b${SPONSORSHIP_WORDS}(?:\s+[a-z]+){0,3}\s+not\s+(?:needed|required)\b`, "i")
];
const SPONSORSHIP_ADVERSE_PATTERNS = [
  new RegExp(String.raw`\b(?:need|needs|needed|require|requires|required|requiring|seek|seeks|seeking)\s+${SPONSORSHIP_WORDS}\b`, "i"),
  new RegExp(String.raw`\b${SPONSORSHIP_WORDS}(?:\s+[a-z]+){0,8}\s+(?:needed|required)\b`, "i")
];

function sponsorshipPolarity(text: string): "POSITIVE" | "ADVERSE" | null {
  const clauses = String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .split(/(?:[.;!?]+|\bbut\b|\bhowever\b|\balthough\b)/)
    .map((clause) => normalizedCandidateStatement(clause))
    .filter((clause) => clause.includes("sponsorship"));
  let polarity: "POSITIVE" | "ADVERSE" | null = null;
  for (const clause of clauses) {
    if (SPONSORSHIP_POSITIVE_PATTERNS.some((pattern) => pattern.test(clause))) {
      polarity ??= "POSITIVE";
      continue;
    }
    if (SPONSORSHIP_ADVERSE_PATTERNS.some((pattern) => pattern.test(clause))) return "ADVERSE";
  }
  return polarity;
}

function normalizedCandidateStatement(value: unknown): string {
  return normalizedSourceExcerpt(value)
    .replace(/\bdon't\b/g, "do not")
    .replace(/\bdoesn't\b/g, "does not")
    .replace(/\bdidn't\b/g, "did not")
    .replace(/\bhaven't\b/g, "have not")
    .replace(/\bhasn't\b/g, "has not")
    .replace(/\bhadn't\b/g, "had not")
    .replace(/\bwon't\b/g, "will not")
    .replace(/\bisn't\b/g, "is not")
    .replace(/\baren't\b/g, "are not")
    .replace(/\bwasn't\b/g, "was not")
    .replace(/\bweren't\b/g, "were not")
    .replace(/\bcan't\b/g, "cannot");
}

function candidateEvidenceIsAdverse(value: unknown): boolean {
  const text = normalizedCandidateStatement(value);
  if (!text) return false;
  const adverseCondition = /\b(?:not authorized|not eligible|cannot|can't|unable|not willing|unwilling)\b/i.test(text)
    || /\b(?:do|does|did) not (?:have|hold|meet|satisfy|possess|qualify)\b/i.test(text)
    || /\b(?:have|has|had) not (?:used|worked)\b/i.test(text)
    || /\b(?:have|has|had) no\b/i.test(text)
    || /\bnever (?:used|worked)\b/i.test(text)
    || /\bnot (?:proficient|experienced|qualified)\b/i.test(text)
    || /\b(?:lack|lacks|lacking)\b/i.test(text)
    || /\bno (?:active |valid )?(?:security )?(?:clearance|license|licence|certification|degree|authorization|citizenship|experience)\b/i.test(text)
    || /\bexpired\b/i.test(text);
  if (adverseCondition) return true;
  return sponsorshipPolarity(String(value ?? "")) === "ADVERSE";
}

const YEAR_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20
};
const YEAR_NUMBER = String.raw`(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)`;

function yearNumber(value: string): number | null {
  return /^\d+$/.test(value) ? Number(value) : YEAR_WORDS[value] ?? null;
}

function requiredMinimumYears(value: unknown): number | null {
  const text = String(value ?? "").normalize("NFKC").toLowerCase();
  const rangePatterns = [
    new RegExp(String.raw`\bbetween\s+(${YEAR_NUMBER})\s+and\s+(${YEAR_NUMBER})\s+years?\b`, "i"),
    new RegExp(String.raw`\b(${YEAR_NUMBER})\s*(?:-|–|—|to)\s*(${YEAR_NUMBER})\s+years?\b`, "i")
  ];
  for (const pattern of rangePatterns) {
    const match = pattern.exec(text);
    if (match) return yearNumber(match[1]);
  }
  const minimumPatterns = [
    new RegExp(String.raw`\b(?:at\s+least|minimum(?:\s+of)?)\s+(${YEAR_NUMBER})\s+years?\b`, "i"),
    new RegExp(String.raw`\b(${YEAR_NUMBER})\s*\+\s*years?\b`, "i"),
    new RegExp(String.raw`\b(${YEAR_NUMBER})\s+years?\s+or\s+more\b`, "i")
  ];
  for (const pattern of minimumPatterns) {
    const match = pattern.exec(text);
    if (match) return yearNumber(match[1]);
  }
  const plain = [...text.matchAll(new RegExp(String.raw`\b(${YEAR_NUMBER})\s+years?\b`, "gi"))];
  return plain.length === 1 ? yearNumber(plain[0][1].toLowerCase()) : null;
}

const DURATION_ANCHOR_STOPWORDS = new Set([
  "ability", "and", "applicant", "applicants", "between", "candidate", "candidates",
  "demonstrated", "experience", "have", "knowledge", "least", "minimum", "more", "must",
  "need", "needs", "of", "or", "plus", "proven", "required", "requirement", "strong", "the",
  "valid", "with", "year", "years"
]);

function durationAnchors(value: unknown): string[] {
  return (normalizedSourceExcerpt(value).match(/[a-z0-9.#+]{3,}/g) ?? [])
    .map((token) => token.replace(/^\.+|\.+$/g, ""))
    .filter((token) => !DURATION_ANCHOR_STOPWORDS.has(token) && !/^\d+$/.test(token));
}

function tokenAnchorPositions(text: string, anchor: string): number[] {
  const positions: number[] = [];
  for (const match of text.matchAll(/[a-z0-9.#+]+/g)) {
    const token = match[0].replace(/^\.+|\.+$/g, "");
    if (token === anchor) positions.push((match.index ?? 0) + match[0].indexOf(token));
  }
  return positions;
}

function relevantCandidateYears(requirement: RequirementAssessment): number | null {
  const anchors = durationAnchors(requirement.sourceRequirement);
  if (anchors.length === 0) return null;
  const relevant: number[] = [];
  for (const reference of requirement.evidence) {
    const text = String(reference.excerpt ?? "").normalize("NFKC").toLowerCase();
    const matches = [...text.matchAll(new RegExp(String.raw`\b(${YEAR_NUMBER})\s+years?\b`, "gi"))];
    const relevantIndexes = new Set<number>();
    for (const anchor of anchors) {
      for (const anchorIndex of tokenAnchorPositions(text, anchor)) {
        const distances = matches.map((match) => Math.abs((match.index ?? 0) - anchorIndex));
        const nearestDistance = Math.min(...distances);
        const nearest = distances
          .map((distance, index) => ({ distance, index }))
          .filter(({ distance }) => distance === nearestDistance);
        if (nearest.length === 1) relevantIndexes.add(nearest[0].index);
      }
    }
    for (const index of relevantIndexes) {
      const years = yearNumber(matches[index][1].toLowerCase());
      if (years !== null) relevant.push(years);
    }
  }
  return relevant.length === 1 ? relevant[0] : null;
}

function mismatchEvidenceIsExplicit(requirement: RequirementAssessment): boolean {
  if (requirement.evidence.some((reference) => candidateEvidenceIsAdverse(reference.excerpt))) return true;
  const requiredYears = requiredMinimumYears(requirement.sourceRequirement);
  const candidateYears = relevantCandidateYears(requirement);
  return requiredYears !== null && candidateYears !== null && candidateYears < requiredYears;
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
  if (action === "CONFIRM_ELIGIBILITY" && assessment.eligibility.status !== "UNCERTAIN") return false;
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
    requirement: requirement.sourceRequirement,
    explanation: requirementExplanation(requirement)
  }));
  const eligibilityItems = assessment.eligibility.items.map((item) => ({
    ...item,
    requirement: item.sourceRequirement,
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

const POSITIVE_QUALIFICATION_PATTERN = /\b(?:authorized|eligible|certified|licensed|qualified|proficient|skilled|experienced|experience|have|has|hold|holds|possess|possesses|use|uses|used|built|build|operate|operates|operated|manage|manages|managed|work|worked|can|able)\b/i;

function visibilityEvidenceSupportsSurfacing(requirement: RequirementAssessment): boolean {
  const evidenceText = requirement.evidence.map((reference) => reference.excerpt).join("\n");
  if (!evidenceText || requirement.evidence.some((reference) => candidateEvidenceIsAdverse(reference.excerpt))) {
    return false;
  }
  const positiveQualification = sponsorshipPolarity(evidenceText) === "POSITIVE"
    || POSITIVE_QUALIFICATION_PATTERN.test(evidenceText);
  if (!positiveQualification) return false;
  if (findUngroundedClaimTerm(requirement.requirement, evidenceText)) return false;
  if (hasUngroundedNumericClaim(requirement.sourceRequirement, evidenceText)) return false;
  const anchors = durationAnchors(requirement.sourceRequirement);
  return anchors.length === 0 || anchors.some((anchor) => normalizedSourceExcerpt(evidenceText).includes(anchor));
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
    if (requirement.canSurfaceInResume && !visibilityEvidenceSupportsSurfacing(requirement)) return null;
  }
  if (assessment.unsupportedClaims.some((claim) => !sourceExcerptIsGrounded(claim, resumeText))) return null;
  if (assessment.presentationIssues.some((issue) => !advisoryProseIsGrounded(issue, jobText, resumeText, honestContext))) return null;
  if (assessment.topEdits.some((edit) => !advisoryProseIsGrounded(edit, jobText, resumeText, honestContext))) return null;

  const requirementVisibility = assessment.requirementVisibility.map((requirement) => ({
    ...requirement,
    requirement: requirement.sourceRequirement,
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
