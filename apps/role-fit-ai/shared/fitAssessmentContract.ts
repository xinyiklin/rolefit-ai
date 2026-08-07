export const FIT_VERDICTS = [
  "STRONG_FIT",
  "REASONABLE_FIT",
  "STRETCH",
  "LIMITED_FIT"
] as const;

export type FitVerdict = (typeof FIT_VERDICTS)[number];

export const FIT_CONFIDENCES = ["HIGH", "MEDIUM", "LOW"] as const;
export type FitConfidence = (typeof FIT_CONFIDENCES)[number];

export const ELIGIBILITY_STATUSES = [
  "SATISFIED",
  "UNCERTAIN",
  "NOT_SATISFIED"
] as const;
export type EligibilityStatus = (typeof ELIGIBILITY_STATUSES)[number];

export const REQUIREMENT_IMPORTANCES = ["CORE", "SUPPORTING"] as const;
export type RequirementImportance = (typeof REQUIREMENT_IMPORTANCES)[number];

export const REQUIREMENT_COVERAGES = [
  "COVERED",
  "ADJACENT",
  "MISSING",
  "UNCERTAIN"
] as const;
export type RequirementCoverage = (typeof REQUIREMENT_COVERAGES)[number];

export const EVIDENCE_SOURCES = ["RESUME", "HONEST_CONTEXT"] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export type EvidenceReference = {
  source: EvidenceSource;
  excerpt: string;
};

export type RequirementAssessment = {
  id: string;
  requirement: string;
  importance: RequirementImportance;
  coverage: RequirementCoverage;
  evidence: EvidenceReference[];
  explanation: string;
  canSurfaceInResume: boolean;
};

export type EligibilityItem = {
  id: string;
  requirement: string;
  status: EligibilityStatus;
  evidence: EvidenceReference[];
  explanation: string;
};

export const FIT_RECOMMENDATION_ACTIONS = [
  "APPLY",
  "POLISH_FIRST",
  "CONFIRM_ELIGIBILITY",
  "APPLY_SELECTIVELY",
  "NOT_RECOMMENDED"
] as const;
export type FitRecommendationAction = (typeof FIT_RECOMMENDATION_ACTIONS)[number];

export type EligibilityAssessment = {
  status: EligibilityStatus;
  items: EligibilityItem[];
};

export type FitAssessment = {
  verdict: FitVerdict;
  confidence: FitConfidence;
  summary: string;
  verdictReason: string;
  eligibility: EligibilityAssessment;
  requirements: RequirementAssessment[];
  strengths: string[];
  concerns: string[];
  recommendation: {
    action: FitRecommendationAction;
    reason: string;
  };
};

export const SUBMISSION_READINESSES = [
  "READY",
  "REVISIONS_RECOMMENDED",
  "EVIDENCE_NEEDED",
  "NOT_READY"
] as const;
export type SubmissionReadiness = (typeof SUBMISSION_READINESSES)[number];

export type SubmissionAssessment = {
  readiness: SubmissionReadiness;
  summary: string;
  requirementVisibility: RequirementAssessment[];
  unsupportedClaims: string[];
  missingEvidence: string[];
  presentationIssues: string[];
  topEdits: string[];
};

type ParseLimits = {
  maxRequirements?: number;
  maxEligibilityItems?: number;
  maxEvidencePerItem?: number;
  maxListItems?: number;
};

const DEFAULT_LIMITS: Required<ParseLimits> = {
  maxRequirements: 40,
  maxEligibilityItems: 16,
  maxEvidencePerItem: 8,
  maxListItems: 16
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasExactKeys(
  value: Record<string, unknown> | null,
  expected: readonly string[]
): value is Record<string, unknown> {
  if (!value) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function exactEnum<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T | null {
  return typeof value === "string" && allowed.includes(value as T)
    ? value as T
    : null;
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function stringList(value: unknown, maxItems: number, maxLength = 600): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const parsed = value.map((item) => text(item, maxLength));
  return parsed.every((item): item is string => item !== null) ? parsed : null;
}

function parseEvidenceReferences(
  value: unknown,
  maxItems: number
): EvidenceReference[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const parsed: EvidenceReference[] = [];
  for (const item of value) {
    const source = record(item);
    if (!hasExactKeys(source, ["source", "excerpt"])) return null;
    const evidenceSource = exactEnum(source?.source, EVIDENCE_SOURCES);
    const excerpt = text(source?.excerpt, 800);
    if (!evidenceSource || !excerpt) return null;
    parsed.push({ source: evidenceSource, excerpt });
  }
  return parsed;
}

function parseRequirement(
  value: unknown,
  maxEvidencePerItem: number
): RequirementAssessment | null {
  const source = record(value);
  if (!hasExactKeys(source, [
    "id",
    "requirement",
    "importance",
    "coverage",
    "evidence",
    "explanation",
    "canSurfaceInResume"
  ])) return null;
  const id = text(source?.id, 120);
  const requirement = text(source?.requirement, 600);
  const importance = exactEnum(source?.importance, REQUIREMENT_IMPORTANCES);
  const coverage = exactEnum(source?.coverage, REQUIREMENT_COVERAGES);
  const evidence = parseEvidenceReferences(source?.evidence, maxEvidencePerItem);
  const explanation = text(source?.explanation, 1_200);
  if (
    !id ||
    !requirement ||
    !importance ||
    !coverage ||
    !evidence ||
    !explanation ||
    typeof source?.canSurfaceInResume !== "boolean"
  ) return null;
  if ((coverage === "COVERED" || coverage === "ADJACENT") && evidence.length === 0) return null;
  if ((coverage === "MISSING" || coverage === "UNCERTAIN") && evidence.length > 0) return null;
  return {
    id,
    requirement,
    importance,
    coverage,
    evidence,
    explanation,
    canSurfaceInResume: source.canSurfaceInResume
  };
}

function uniqueIds(items: { id: string }[]): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

function parseRequirements(
  value: unknown,
  limits: Required<ParseLimits>,
  allowEmpty: boolean
): RequirementAssessment[] | null {
  if (!Array.isArray(value) || value.length > limits.maxRequirements) return null;
  if (!allowEmpty && value.length === 0) return null;
  const requirements = value.map((item) => parseRequirement(item, limits.maxEvidencePerItem));
  if (!requirements.every((item): item is RequirementAssessment => item !== null)) return null;
  return uniqueIds(requirements) ? requirements : null;
}

function parseEligibilityItem(
  value: unknown,
  maxEvidencePerItem: number
): EligibilityItem | null {
  const source = record(value);
  if (!hasExactKeys(source, ["id", "requirement", "status", "evidence", "explanation"])) return null;
  const id = text(source?.id, 120);
  const requirement = text(source?.requirement, 600);
  const status = exactEnum(source?.status, ELIGIBILITY_STATUSES);
  const evidence = parseEvidenceReferences(source?.evidence, maxEvidencePerItem);
  const explanation = text(source?.explanation, 1_200);
  if (!id || !requirement || !status || !evidence || !explanation) return null;
  if ((status === "SATISFIED" || status === "NOT_SATISFIED") && evidence.length === 0) return null;
  if (status === "UNCERTAIN" && evidence.length > 0) return null;
  return { id, requirement, status, evidence, explanation };
}

function expectedEligibilityStatus(items: EligibilityItem[]): EligibilityStatus {
  if (items.some((item) => item.status === "NOT_SATISFIED")) return "NOT_SATISFIED";
  if (items.some((item) => item.status === "UNCERTAIN")) return "UNCERTAIN";
  return "SATISFIED";
}

function parseEligibility(
  value: unknown,
  limits: Required<ParseLimits>
): EligibilityAssessment | null {
  const source = record(value);
  if (!hasExactKeys(source, ["status", "items"])) return null;
  const status = exactEnum(source?.status, ELIGIBILITY_STATUSES);
  if (!status || !Array.isArray(source?.items) || source.items.length > limits.maxEligibilityItems) {
    return null;
  }
  const items = source.items.map((item) => parseEligibilityItem(item, limits.maxEvidencePerItem));
  if (!items.every((item): item is EligibilityItem => item !== null) || !uniqueIds(items)) return null;
  return status === expectedEligibilityStatus(items) ? { status, items } : null;
}

export function parseFitAssessment(
  value: unknown,
  options: ParseLimits = {}
): FitAssessment | null {
  const limits = { ...DEFAULT_LIMITS, ...options };
  const source = record(value);
  if (!hasExactKeys(source, [
    "verdict",
    "confidence",
    "summary",
    "verdictReason",
    "eligibility",
    "requirements",
    "strengths",
    "concerns",
    "recommendation"
  ])) return null;
  const verdict = exactEnum(source?.verdict, FIT_VERDICTS);
  const confidence = exactEnum(source?.confidence, FIT_CONFIDENCES);
  const summary = text(source?.summary, 1_200);
  const verdictReason = text(source?.verdictReason, 1_200);
  const eligibility = parseEligibility(source?.eligibility, limits);
  const requirements = parseRequirements(source?.requirements, limits, false);
  const strengths = stringList(source?.strengths, limits.maxListItems);
  const concerns = stringList(source?.concerns, limits.maxListItems);
  const recommendationSource = record(source?.recommendation);
  if (!hasExactKeys(recommendationSource, ["action", "reason"])) return null;
  const action = exactEnum(recommendationSource?.action, FIT_RECOMMENDATION_ACTIONS);
  const recommendationReason = text(recommendationSource?.reason, 1_200);
  if (
    !verdict ||
    !confidence ||
    !summary ||
    !verdictReason ||
    !eligibility ||
    !requirements ||
    !strengths ||
    !concerns ||
    !action ||
    !recommendationReason
  ) return null;
  return {
    verdict,
    confidence,
    summary,
    verdictReason,
    eligibility,
    requirements,
    strengths,
    concerns,
    recommendation: { action, reason: recommendationReason }
  };
}

export function parseSubmissionAssessment(
  value: unknown,
  options: ParseLimits = {}
): SubmissionAssessment | null {
  const limits = { ...DEFAULT_LIMITS, ...options };
  const source = record(value);
  if (!hasExactKeys(source, [
    "readiness",
    "summary",
    "requirementVisibility",
    "unsupportedClaims",
    "missingEvidence",
    "presentationIssues",
    "topEdits"
  ])) return null;
  const readiness = exactEnum(source?.readiness, SUBMISSION_READINESSES);
  const summary = text(source?.summary, 1_200);
  const requirementVisibility = parseRequirements(source?.requirementVisibility, limits, true);
  const unsupportedClaims = stringList(source?.unsupportedClaims, limits.maxListItems);
  const missingEvidence = stringList(source?.missingEvidence, limits.maxListItems);
  const presentationIssues = stringList(source?.presentationIssues, limits.maxListItems);
  const topEdits = stringList(source?.topEdits, limits.maxListItems);
  if (
    !readiness ||
    !summary ||
    !requirementVisibility ||
    !unsupportedClaims ||
    !missingEvidence ||
    !presentationIssues ||
    !topEdits
  ) return null;
  if (readiness === "READY" && (unsupportedClaims.length > 0 || missingEvidence.length > 0)) return null;
  return {
    readiness,
    summary,
    requirementVisibility,
    unsupportedClaims,
    missingEvidence,
    presentationIssues,
    topEdits
  };
}
