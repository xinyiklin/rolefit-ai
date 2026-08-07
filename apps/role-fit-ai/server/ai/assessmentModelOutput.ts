import {
  ELIGIBILITY_STATUSES,
  EVIDENCE_SOURCES,
  FIT_CONFIDENCES,
  FIT_RECOMMENDATION_ACTIONS,
  FIT_VERDICTS,
  REQUIREMENT_COVERAGES,
  REQUIREMENT_IMPORTANCES,
  SUBMISSION_READINESSES,
  type EligibilityStatus,
  type EvidenceReference,
  type FitConfidence,
  type FitRecommendationAction,
  type FitVerdict,
  type RequirementCoverage,
  type RequirementImportance,
  type SubmissionReadiness
} from "../../shared/fitAssessmentContract.ts";

export type ModelFitAssessment = {
  verdict: FitVerdict;
  confidence: FitConfidence;
  eligibility: {
    items: Array<{
      sourceRequirement: string;
      status: EligibilityStatus;
      evidence: EvidenceReference[];
    }>;
  };
  requirements: Array<{
    sourceRequirement: string;
    importance: RequirementImportance;
    coverage: RequirementCoverage;
    evidence: EvidenceReference[];
  }>;
  recommendation: {
    action: FitRecommendationAction;
  };
};

export type ModelSubmissionAssessment = {
  readiness: SubmissionReadiness;
  requirementVisibility: Array<{
    sourceRequirement: string;
    importance: RequirementImportance;
    coverage: RequirementCoverage;
    evidence: EvidenceReference[];
  }>;
  unsupportedClaims: string[];
  presentationIssues: string[];
  topEdits: string[];
};

export type AssessmentIssuePhase = "shape" | "grounding" | "consistency";

export type AssessmentIssueCode =
  | "EXPECTED_OBJECT"
  | "INVALID_ENVELOPE"
  | "MISSING_FIELD"
  | "UNEXPECTED_FIELD"
  | "FORBIDDEN_NUMERICAL_FIELD"
  | "INVALID_ENUM"
  | "INVALID_STRING"
  | "STRING_TOO_LONG"
  | "INVALID_ARRAY"
  | "TOO_MANY_ITEMS"
  | "EMPTY_REQUIREMENTS"
  | "INVALID_EVIDENCE_SOURCE"
  | "INVALID_COVERAGE_EVIDENCE"
  | "INVALID_ELIGIBILITY_EVIDENCE"
  | "DUPLICATE_SOURCE_REQUIREMENT"
  | "CROSS_LEDGER_SOURCE_REQUIREMENT"
  | "SOURCE_REQUIREMENT_NOT_IN_JOB"
  | "EVIDENCE_NOT_IN_SOURCE"
  | "UNGROUNDED_NUMERIC_CLAIM"
  | "MISSING_MISMATCH_EVIDENCE"
  | "INVALID_ELIGIBILITY_POLARITY"
  | "INCONSISTENT_VERDICT"
  | "INCONSISTENT_RECOMMENDATION"
  | "UNSUPPORTED_CLAIM_NOT_IN_RESUME"
  | "UNGROUNDED_ADVICE"
  | "INCONSISTENT_READINESS"
  | "CANONICALIZATION_FAILED";

export type AssessmentIssue = {
  phase: AssessmentIssuePhase;
  code: AssessmentIssueCode;
  path: string;
};

export type AssessmentResult<T> =
  | { ok: true; value: T }
  | { ok: false; issue: AssessmentIssue };

export const MODEL_FIT_ASSESSMENT_EXAMPLE: { fitAssessment: ModelFitAssessment } = {
  fitAssessment: {
    verdict: "REASONABLE_FIT",
    confidence: "MEDIUM",
    eligibility: {
      items: [{
        sourceRequirement: "Exact eligibility condition from the job",
        status: "UNCERTAIN",
        evidence: []
      }]
    },
    requirements: [{
      sourceRequirement: "Exact capability requirement from the job",
      importance: "CORE",
      coverage: "COVERED",
      evidence: [{ source: "RESUME", excerpt: "Exact evidence from the resume" }]
    }],
    recommendation: { action: "POLISH_FIRST" }
  }
};

export const MODEL_SUBMISSION_ASSESSMENT_EXAMPLE: { submissionAssessment: ModelSubmissionAssessment } = {
  submissionAssessment: {
    readiness: "REVISIONS_RECOMMENDED",
    requirementVisibility: [{
      sourceRequirement: "Exact capability requirement from the job",
      importance: "CORE",
      coverage: "COVERED",
      evidence: [{ source: "RESUME", excerpt: "Exact evidence from the resume" }]
    }],
    unsupportedClaims: [],
    presentationIssues: ["Grounded document presentation issue"],
    topEdits: ["Grounded high-value document edit"]
  }
};

const MAX_REQUIREMENTS = 40;
const MAX_ELIGIBILITY_ITEMS = 16;
const MAX_EVIDENCE_PER_ITEM = 8;
const MAX_ADVICE_ITEMS = 16;

const FORBIDDEN_NUMERICAL_FIELDS = new Set([
  "score",
  "aiScore",
  "baseScore",
  "tailoredScore",
  "fitLift"
]);

const SAFE_PATH_SEGMENTS = new Set([
  "fitAssessment",
  "submissionAssessment",
  "verdict",
  "confidence",
  "eligibility",
  "items",
  "requirements",
  "recommendation",
  "action",
  "readiness",
  "requirementVisibility",
  "unsupportedClaims",
  "presentationIssues",
  "topEdits",
  "sourceRequirement",
  "status",
  "importance",
  "coverage",
  "evidence",
  "source",
  "excerpt",
  "summary",
  "verdictReason",
  "strengths",
  "concerns",
  "missingEvidence",
  "id",
  "requirement",
  "explanation",
  "reason",
  "canSurfaceInResume",
  ...FORBIDDEN_NUMERICAL_FIELDS
]);

function success<T>(value: T): AssessmentResult<T> {
  return { ok: true, value };
}

function failure(
  phase: AssessmentIssuePhase,
  code: AssessmentIssueCode,
  path: string
): AssessmentResult<never> {
  return { ok: false, issue: { phase, code, path } };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function childPath(path: string, key: string): string {
  const segment = SAFE_PATH_SEGMENTS.has(key) ? key : "*";
  return path ? `${path}.${segment}` : segment;
}

function forbiddenNumericalFieldPath(value: unknown, path = ""): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = forbiddenNumericalFieldPath(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  const source = record(value);
  if (!source) return null;
  for (const [key, child] of Object.entries(source)) {
    const nextPath = childPath(path, key);
    if (FORBIDDEN_NUMERICAL_FIELDS.has(key)) return nextPath;
    const found = forbiddenNumericalFieldPath(child, nextPath);
    if (found) return found;
  }
  return null;
}

function validateObjectKeys(
  source: Record<string, unknown>,
  path: string,
  required: readonly string[],
  ignored: readonly string[] = []
): AssessmentResult<Record<string, unknown>> {
  for (const key of required) {
    if (!Object.hasOwn(source, key)) return failure("shape", "MISSING_FIELD", childPath(path, key));
  }
  const allowed = new Set([...required, ...ignored]);
  if (Object.keys(source).some((key) => !allowed.has(key))) {
    return failure("shape", "UNEXPECTED_FIELD", path);
  }
  return success(source);
}

function parseText(value: unknown, path: string, maxLength: number): AssessmentResult<string> {
  if (typeof value !== "string") return failure("shape", "INVALID_STRING", path);
  const normalized = value.trim();
  if (!normalized) return failure("shape", "INVALID_STRING", path);
  if (normalized.length > maxLength) return failure("shape", "STRING_TOO_LONG", path);
  return success(normalized);
}

function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string
): AssessmentResult<T> {
  return typeof value === "string" && allowed.includes(value as T)
    ? success(value as T)
    : failure("shape", "INVALID_ENUM", path);
}

function parseArray(value: unknown, path: string, maxItems: number): AssessmentResult<unknown[]> {
  if (!Array.isArray(value)) return failure("shape", "INVALID_ARRAY", path);
  if (value.length > maxItems) return failure("shape", "TOO_MANY_ITEMS", path);
  return success(value);
}

function parseEvidence(value: unknown, path: string): AssessmentResult<EvidenceReference[]> {
  const array = parseArray(value, path, MAX_EVIDENCE_PER_ITEM);
  if (!array.ok) return array;
  const references: EvidenceReference[] = [];
  for (let index = 0; index < array.value.length; index += 1) {
    const itemPath = `${path}[${index}]`;
    const source = record(array.value[index]);
    if (!source) return failure("shape", "EXPECTED_OBJECT", itemPath);
    const keys = validateObjectKeys(source, itemPath, ["source", "excerpt"]);
    if (!keys.ok) return keys;
    const evidenceSource = parseEnum(source.source, EVIDENCE_SOURCES, `${itemPath}.source`);
    if (!evidenceSource.ok) {
      return failure("shape", "INVALID_EVIDENCE_SOURCE", `${itemPath}.source`);
    }
    const excerpt = parseText(source.excerpt, `${itemPath}.excerpt`, 800);
    if (!excerpt.ok) return excerpt;
    references.push({ source: evidenceSource.value, excerpt: excerpt.value });
  }
  return success(references);
}

type ModelRequirement = ModelFitAssessment["requirements"][number];
type ModelEligibilityItem = ModelFitAssessment["eligibility"]["items"][number];

function parseRequirement(
  value: unknown,
  path: string,
  mode: "fit" | "submission"
): AssessmentResult<ModelRequirement> {
  const source = record(value);
  if (!source) return failure("shape", "EXPECTED_OBJECT", path);
  const keys = validateObjectKeys(
    source,
    path,
    ["sourceRequirement", "importance", "coverage", "evidence"],
    ["id", "requirement", "explanation", "canSurfaceInResume"]
  );
  if (!keys.ok) return keys;
  const sourceRequirement = parseText(source.sourceRequirement, `${path}.sourceRequirement`, 800);
  if (!sourceRequirement.ok) return sourceRequirement;
  const importance = parseEnum(source.importance, REQUIREMENT_IMPORTANCES, `${path}.importance`);
  if (!importance.ok) return importance;
  const coverage = parseEnum(source.coverage, REQUIREMENT_COVERAGES, `${path}.coverage`);
  if (!coverage.ok) return coverage;
  const evidence = parseEvidence(source.evidence, `${path}.evidence`);
  if (!evidence.ok) return evidence;

  if (mode === "fit") {
    if (coverage.value === "UNCERTAIN" && evidence.value.length > 0) {
      return failure("consistency", "INVALID_COVERAGE_EVIDENCE", `${path}.evidence`);
    }
    if (coverage.value !== "UNCERTAIN" && evidence.value.length === 0) {
      return failure("consistency", "INVALID_COVERAGE_EVIDENCE", `${path}.evidence`);
    }
  } else {
    if (
      (coverage.value === "COVERED" || coverage.value === "ADJACENT")
      && (evidence.value.length === 0 || evidence.value.some((item) => item.source !== "RESUME"))
    ) {
      return failure("consistency", "INVALID_COVERAGE_EVIDENCE", `${path}.evidence`);
    }
    if (coverage.value === "UNCERTAIN" && evidence.value.length > 0) {
      return failure("consistency", "INVALID_COVERAGE_EVIDENCE", `${path}.evidence`);
    }
    if (coverage.value === "MISSING" && evidence.value.some((item) => item.source !== "HONEST_CONTEXT")) {
      return failure("consistency", "INVALID_COVERAGE_EVIDENCE", `${path}.evidence`);
    }
  }

  return success({
    sourceRequirement: sourceRequirement.value,
    importance: importance.value,
    coverage: coverage.value,
    evidence: evidence.value
  });
}

function parseEligibilityItem(value: unknown, path: string): AssessmentResult<ModelEligibilityItem> {
  const source = record(value);
  if (!source) return failure("shape", "EXPECTED_OBJECT", path);
  const keys = validateObjectKeys(
    source,
    path,
    ["sourceRequirement", "status", "evidence"],
    ["id", "requirement", "explanation"]
  );
  if (!keys.ok) return keys;
  const sourceRequirement = parseText(source.sourceRequirement, `${path}.sourceRequirement`, 800);
  if (!sourceRequirement.ok) return sourceRequirement;
  const status = parseEnum(source.status, ELIGIBILITY_STATUSES, `${path}.status`);
  if (!status.ok) return status;
  const evidence = parseEvidence(source.evidence, `${path}.evidence`);
  if (!evidence.ok) return evidence;
  if (status.value === "UNCERTAIN" && evidence.value.length > 0) {
    return failure("consistency", "INVALID_ELIGIBILITY_EVIDENCE", `${path}.evidence`);
  }
  if (status.value !== "UNCERTAIN" && evidence.value.length === 0) {
    return failure("consistency", "INVALID_ELIGIBILITY_EVIDENCE", `${path}.evidence`);
  }
  return success({
    sourceRequirement: sourceRequirement.value,
    status: status.value,
    evidence: evidence.value
  });
}

function normalizedRequirementSource(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9.+#']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validateUniqueSources(
  items: Array<{ sourceRequirement: string }>,
  path: string
): AssessmentResult<true> {
  const seen = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const source = normalizedRequirementSource(items[index].sourceRequirement);
    if (seen.has(source)) {
      return failure("consistency", "DUPLICATE_SOURCE_REQUIREMENT", `${path}[${index}].sourceRequirement`);
    }
    seen.add(source);
  }
  return success(true);
}

function parseStringList(value: unknown, path: string): AssessmentResult<string[]> {
  const array = parseArray(value, path, MAX_ADVICE_ITEMS);
  if (!array.ok) return array;
  const output: string[] = [];
  for (let index = 0; index < array.value.length; index += 1) {
    const item = parseText(array.value[index], `${path}[${index}]`, 600);
    if (!item.ok) return item;
    output.push(item.value);
  }
  return success(output);
}

export function parseModelFitAssessmentEnvelope(
  value: unknown
): AssessmentResult<ModelFitAssessment> {
  const forbiddenPath = forbiddenNumericalFieldPath(value);
  if (forbiddenPath) return failure("shape", "FORBIDDEN_NUMERICAL_FIELD", forbiddenPath);
  const envelope = record(value);
  if (!envelope) return failure("shape", "EXPECTED_OBJECT", "fitAssessment");
  if (Object.keys(envelope).length !== 1 || !Object.hasOwn(envelope, "fitAssessment")) {
    return failure("shape", "INVALID_ENVELOPE", "fitAssessment");
  }
  const source = record(envelope.fitAssessment);
  if (!source) return failure("shape", "EXPECTED_OBJECT", "fitAssessment");
  const keys = validateObjectKeys(
    source,
    "fitAssessment",
    ["verdict", "confidence", "eligibility", "requirements", "recommendation"],
    ["summary", "verdictReason", "strengths", "concerns"]
  );
  if (!keys.ok) return keys;
  const verdict = parseEnum(source.verdict, FIT_VERDICTS, "fitAssessment.verdict");
  if (!verdict.ok) return verdict;
  const confidence = parseEnum(source.confidence, FIT_CONFIDENCES, "fitAssessment.confidence");
  if (!confidence.ok) return confidence;

  const eligibilitySource = record(source.eligibility);
  if (!eligibilitySource) return failure("shape", "EXPECTED_OBJECT", "fitAssessment.eligibility");
  const eligibilityKeys = validateObjectKeys(
    eligibilitySource,
    "fitAssessment.eligibility",
    ["items"],
    ["status"]
  );
  if (!eligibilityKeys.ok) return eligibilityKeys;
  const eligibilityArray = parseArray(
    eligibilitySource.items,
    "fitAssessment.eligibility.items",
    MAX_ELIGIBILITY_ITEMS
  );
  if (!eligibilityArray.ok) return eligibilityArray;
  const eligibilityItems: ModelEligibilityItem[] = [];
  for (let index = 0; index < eligibilityArray.value.length; index += 1) {
    const item = parseEligibilityItem(
      eligibilityArray.value[index],
      `fitAssessment.eligibility.items[${index}]`
    );
    if (!item.ok) return item;
    eligibilityItems.push(item.value);
  }
  const uniqueEligibility = validateUniqueSources(eligibilityItems, "fitAssessment.eligibility.items");
  if (!uniqueEligibility.ok) return uniqueEligibility;

  const requirementArray = parseArray(source.requirements, "fitAssessment.requirements", MAX_REQUIREMENTS);
  if (!requirementArray.ok) return requirementArray;
  if (requirementArray.value.length === 0) {
    return failure("shape", "EMPTY_REQUIREMENTS", "fitAssessment.requirements");
  }
  const requirements: ModelRequirement[] = [];
  for (let index = 0; index < requirementArray.value.length; index += 1) {
    const requirement = parseRequirement(requirementArray.value[index], `fitAssessment.requirements[${index}]`, "fit");
    if (!requirement.ok) return requirement;
    requirements.push(requirement.value);
  }
  const uniqueRequirements = validateUniqueSources(requirements, "fitAssessment.requirements");
  if (!uniqueRequirements.ok) return uniqueRequirements;
  const requirementSources = new Set(requirements.map((item) => normalizedRequirementSource(item.sourceRequirement)));
  const crossLedgerIndex = eligibilityItems.findIndex((item) => requirementSources.has(normalizedRequirementSource(item.sourceRequirement)));
  if (crossLedgerIndex >= 0) {
    return failure(
      "consistency",
      "CROSS_LEDGER_SOURCE_REQUIREMENT",
      `fitAssessment.eligibility.items[${crossLedgerIndex}].sourceRequirement`
    );
  }

  const recommendationSource = record(source.recommendation);
  if (!recommendationSource) return failure("shape", "EXPECTED_OBJECT", "fitAssessment.recommendation");
  const recommendationKeys = validateObjectKeys(
    recommendationSource,
    "fitAssessment.recommendation",
    ["action"],
    ["reason"]
  );
  if (!recommendationKeys.ok) return recommendationKeys;
  const action = parseEnum(
    recommendationSource.action,
    FIT_RECOMMENDATION_ACTIONS,
    "fitAssessment.recommendation.action"
  );
  if (!action.ok) return action;

  return success({
    verdict: verdict.value,
    confidence: confidence.value,
    eligibility: { items: eligibilityItems },
    requirements,
    recommendation: { action: action.value }
  });
}

export function parseModelSubmissionAssessmentEnvelope(
  value: unknown
): AssessmentResult<ModelSubmissionAssessment> {
  const forbiddenPath = forbiddenNumericalFieldPath(value);
  if (forbiddenPath) return failure("shape", "FORBIDDEN_NUMERICAL_FIELD", forbiddenPath);
  const envelope = record(value);
  if (!envelope) return failure("shape", "EXPECTED_OBJECT", "submissionAssessment");
  if (Object.keys(envelope).length !== 1 || !Object.hasOwn(envelope, "submissionAssessment")) {
    return failure("shape", "INVALID_ENVELOPE", "submissionAssessment");
  }
  const source = record(envelope.submissionAssessment);
  if (!source) return failure("shape", "EXPECTED_OBJECT", "submissionAssessment");
  const keys = validateObjectKeys(
    source,
    "submissionAssessment",
    ["readiness", "requirementVisibility", "unsupportedClaims", "presentationIssues", "topEdits"],
    ["summary", "missingEvidence"]
  );
  if (!keys.ok) return keys;
  const readiness = parseEnum(source.readiness, SUBMISSION_READINESSES, "submissionAssessment.readiness");
  if (!readiness.ok) return readiness;
  const visibilityArray = parseArray(
    source.requirementVisibility,
    "submissionAssessment.requirementVisibility",
    MAX_REQUIREMENTS
  );
  if (!visibilityArray.ok) return visibilityArray;
  const requirementVisibility: ModelRequirement[] = [];
  for (let index = 0; index < visibilityArray.value.length; index += 1) {
    const requirement = parseRequirement(
      visibilityArray.value[index],
      `submissionAssessment.requirementVisibility[${index}]`,
      "submission"
    );
    if (!requirement.ok) return requirement;
    requirementVisibility.push(requirement.value);
  }
  const uniqueRequirements = validateUniqueSources(
    requirementVisibility,
    "submissionAssessment.requirementVisibility"
  );
  if (!uniqueRequirements.ok) return uniqueRequirements;
  const unsupportedClaims = parseStringList(source.unsupportedClaims, "submissionAssessment.unsupportedClaims");
  if (!unsupportedClaims.ok) return unsupportedClaims;
  const presentationIssues = parseStringList(source.presentationIssues, "submissionAssessment.presentationIssues");
  if (!presentationIssues.ok) return presentationIssues;
  const topEdits = parseStringList(source.topEdits, "submissionAssessment.topEdits");
  if (!topEdits.ok) return topEdits;

  return success({
    readiness: readiness.value,
    requirementVisibility,
    unsupportedClaims: unsupportedClaims.value,
    presentationIssues: presentationIssues.value,
    topEdits: topEdits.value
  });
}
