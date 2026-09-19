import { sanitizeContentWarnings } from "./contentWarnings.ts";
export const FIT_ASSESSMENT_VERDICTS = ["STRONG", "REASONABLE", "STRETCH", "LIMITED"] as const;
export const FIT_ASSESSMENT_ELIGIBILITY = ["CLEAR", "CHECK", "BLOCKED"] as const;
export const FIT_ASSESSMENT_EVIDENCE_SOURCES = ["RESUME", "CANDIDATE_CONTEXT"] as const;
export const FIT_ASSESSMENT_INPUT_CHANGES = ["job", "resume", "candidate-context", "settings"] as const;
export const FIT_ASSESSMENT_PROMPT_VERSION = "fit-assessment-direct-rubric-v6";

export type FitAssessmentVerdict = (typeof FIT_ASSESSMENT_VERDICTS)[number];
export type FitAssessmentEligibilityStatus = (typeof FIT_ASSESSMENT_ELIGIBILITY)[number];
export type FitAssessmentEvidenceSource = (typeof FIT_ASSESSMENT_EVIDENCE_SOURCES)[number];
export type FitAssessmentInputChange = (typeof FIT_ASSESSMENT_INPUT_CHANGES)[number];

export type FitAssessmentMatch = {
  jobExcerpt: string;
  candidateSource: FitAssessmentEvidenceSource;
  candidateExcerpt: string;
  relationship?: "direct" | "transferable";
};

export const FIT_ASSESSMENT_SUMMARY: Record<FitAssessmentVerdict, string> = {
  STRONG: "Your background aligns closely with the role’s main requirements.",
  REASONABLE: "Your background aligns well, with a few material gaps.",
  STRETCH: "You have relevant experience, but several important gaps remain.",
  LIMITED: "The resume shows limited direct evidence for the role’s main requirements."
};

// Fit Assessment uses the same canonical text on the client and server. Friendly
// file labels stay outside this boundary because renaming a file does not
// change what was screened.
export function normalizeFitAssessmentInput(value: unknown): string {
  return String(value ?? "").normalize("NFKC").replace(/\r\n?/g, "\n").trim();
}

export type FitAssessmentGapDetail = {
  jobExcerpt: string;
  note?: string;
  relationship?: "transferable" | "contradictory";
  candidateSource?: FitAssessmentEvidenceSource;
  candidateExcerpt?: string;
};

export const INSUFFICIENT_JOB_SUMMARY = "Add substantive role responsibilities or qualifications to assess fit.";

export type FitAssessmentResult = {
  status: "ASSESSED";
  warnings?: string[];
  verdict: FitAssessmentVerdict;
  summary: string;
  matches: FitAssessmentMatch[];
  gaps: string[];
  gapDetails?: FitAssessmentGapDetail[];
  eligibility?: {
    status: FitAssessmentEligibilityStatus;
    jobExcerpt?: string;
    candidateExcerpt?: string;
    note?: string;
  };
} | {
  status: "INSUFFICIENT_JOB_INFORMATION";
  warnings?: string[];
  summary: string;
  verdict?: never;
  matches: [];
  gaps: [];
  gapDetails?: never;
  eligibility?: never;
};

export type FitAssessmentSnapshot = {
  result: FitAssessmentResult;
  resumeLabel: string;
  assessedAt?: string;
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  attempts?: number;
  promptVersion?: string;
};

export type FitAssessmentProvenance = {
  screeningJobFingerprint: string;
  resumeFingerprint: string;
  candidateContextFingerprint: string;
  requestIdentityFingerprint: string;
  inputFingerprint: string;
};

export type FitAssessmentRunKind = "prepare" | "reassess" | "resume-change";

export type FitAssessmentActiveRun = {
  id: string;
  kind: FitAssessmentRunKind;
  resumeLabel: string;
  prepareRunId?: string;
  // Only a Prepare-owned first assessment receives this one-use token.
  // Retries, reassessments, resume changes, and restored results omit it.
  automationToken?: string;
};

export type FitAssessmentCompleted = {
  snapshot: FitAssessmentSnapshot;
  // Tracker restores retain the result but cannot reconstruct exact request
  // provenance, so they remain historical and automation-ineligible.
  provenance?: FitAssessmentProvenance;
  origin: "current" | "saved";
  changes: FitAssessmentInputChange[];
  previousPreparation: boolean;
  prepareRunId?: string;
  automationToken?: string;
};

// Durable completion and transient request state are deliberately independent.
// Beginning, failing, disabling, or cancelling a new request must never erase
// the last completed assessment.
export type FitAssessmentState = {
  enabled: boolean;
  latestCompleted: FitAssessmentCompleted | null;
  activeRun: FitAssessmentActiveRun | null;
  lastError: { resumeLabel: string; message: string } | null;
};

const verdicts = new Set<string>(FIT_ASSESSMENT_VERDICTS);
const eligibilityStatuses = new Set<string>(FIT_ASSESSMENT_ELIGIBILITY);

function text(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function excerpt(value: unknown, maxLength = 500): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length <= maxLength && !/<[^>]*>/.test(trimmed) ? trimmed : "";
}

function excerptList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const result: string[] = [];
  for (const item of value) {
    const cleaned = excerpt(item);
    if (!cleaned) return null;
    result.push(cleaned);
  }
  return result;
}

function matchList(value: unknown): FitAssessmentMatch[] | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const matches: FitAssessmentMatch[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const source = item as Record<string, unknown>;
    const jobExcerpt = excerpt(source.jobExcerpt);
    const candidateExcerpt = excerpt(source.candidateExcerpt);
    const candidateSource = text(source.candidateSource, 32).toUpperCase();
    if (
      !jobExcerpt
      || (typeof source.candidateExcerpt !== "string" || (source.candidateExcerpt.trim() && !candidateExcerpt))
      || !FIT_ASSESSMENT_EVIDENCE_SOURCES.includes(candidateSource as FitAssessmentEvidenceSource)
    ) return null;
    matches.push({
      jobExcerpt,
      candidateSource: candidateSource as FitAssessmentEvidenceSource,
      candidateExcerpt,
      ...(source.relationship === "direct" || source.relationship === "transferable" ? { relationship: source.relationship } : {})
    });
  }
  return matches;
}

export function sanitizeFitAssessment(raw: unknown): FitAssessmentResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const warnings = sanitizeContentWarnings(source.warnings);
  if (source.warnings !== undefined && !warnings) return null;
  if (source.status === "INSUFFICIENT_JOB_INFORMATION") {
    if (source.verdict !== undefined || source.eligibility !== undefined || (Array.isArray(source.matches) && source.matches.length) || (Array.isArray(source.gaps) && source.gaps.length)) return null;
    return { status: "INSUFFICIENT_JOB_INFORMATION", summary: INSUFFICIENT_JOB_SUMMARY, matches: [], gaps: [], ...(warnings ? { warnings } : {}) };
  }
  if (source.status !== undefined && source.status !== "ASSESSED") return null;
  const verdict = text(source.verdict, 24).toUpperCase();
  if (!verdicts.has(verdict)) return null;
  if (source.summary !== undefined && (typeof source.summary !== "string" || source.summary.length > 500 || /<[^>]*>/.test(source.summary))) return null;
  const matches = matchList(source.matches);
  const gaps = excerptList(source.gaps);
  if (!matches || !gaps) return null;

  const rawEligibility = source.eligibility;
  let eligibility: FitAssessmentResult["eligibility"];
  if (rawEligibility !== undefined && rawEligibility !== null) {
    if (typeof rawEligibility !== "object" || Array.isArray(rawEligibility)) return null;
    const eligibilitySource = rawEligibility as Record<string, unknown>;
    const status = text(eligibilitySource.status, 16).toUpperCase();
    if (!eligibilityStatuses.has(status)) return null;
    if (eligibilitySource.note !== undefined && (typeof eligibilitySource.note !== "string" || eligibilitySource.note.length > 240 || /<[^>]*>/.test(eligibilitySource.note))) return null;
    for (const field of ["jobExcerpt", "candidateExcerpt"] as const) {
      if (eligibilitySource[field] !== undefined && eligibilitySource[field] !== "" && !excerpt(eligibilitySource[field])) return null;
    }
    const note = text(eligibilitySource.note, 240);
    const jobExcerpt = excerpt(eligibilitySource.jobExcerpt);
    const candidateExcerpt = excerpt(eligibilitySource.candidateExcerpt);
    eligibility = {
      status: status as FitAssessmentEligibilityStatus,
      ...(jobExcerpt ? { jobExcerpt } : {}),
      ...(candidateExcerpt ? { candidateExcerpt } : {}),
      ...(note ? { note } : {})
    };
  }

  const gapDetails: FitAssessmentGapDetail[] = [];
  if (source.gapDetails !== undefined) {
    if (!Array.isArray(source.gapDetails) || source.gapDetails.length > 3) return null;
    for (const rawDetail of source.gapDetails) {
      if (!rawDetail || typeof rawDetail !== "object" || Array.isArray(rawDetail)) return null;
      const detail = rawDetail as FitAssessmentGapDetail;
      if (!gaps.includes(detail.jobExcerpt)) return null;
      if (detail.relationship !== undefined && !["transferable", "contradictory"].includes(detail.relationship)) return null;
      if (detail.candidateSource !== undefined && !FIT_ASSESSMENT_EVIDENCE_SOURCES.includes(detail.candidateSource)) return null;
      if (detail.candidateExcerpt !== undefined && !excerpt(detail.candidateExcerpt)) return null;
      if (detail.note !== undefined && (typeof detail.note !== "string" || detail.note.length > 240 || /<[^>]*>/.test(detail.note))) return null;
      gapDetails.push({ jobExcerpt: detail.jobExcerpt,
        ...(detail.note ? { note: detail.note } : {}),
        ...(detail.relationship ? { relationship: detail.relationship } : {}),
        ...(detail.candidateSource ? { candidateSource: detail.candidateSource } : {}),
        ...(detail.candidateExcerpt ? { candidateExcerpt: detail.candidateExcerpt } : {}) });
    }
  }
  const typedVerdict = verdict as FitAssessmentVerdict;
  return {
    status: "ASSESSED",
    verdict: typedVerdict,
    summary: text(source.summary, 500) || FIT_ASSESSMENT_SUMMARY[typedVerdict],
    ...(warnings ? { warnings } : {}),
    matches,
    gaps,
    ...(gapDetails.length ? {gapDetails} : {}),
    ...(eligibility ? { eligibility } : {})
  };
}
