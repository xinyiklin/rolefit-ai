export const FIT_ASSESSMENT_VERDICTS = ["STRONG", "REASONABLE", "STRETCH", "LIMITED"] as const;
export const FIT_ASSESSMENT_ELIGIBILITY = ["CLEAR", "CHECK", "BLOCKED"] as const;
export const FIT_ASSESSMENT_EVIDENCE_SOURCES = ["RESUME", "CANDIDATE_CONTEXT"] as const;
export const FIT_ASSESSMENT_INPUT_CHANGES = ["job", "resume", "candidate-context", "settings"] as const;
export const FIT_ASSESSMENT_PROMPT_VERSION = "fit-assessment-direct-rubric-v3";

export type FitAssessmentVerdict = (typeof FIT_ASSESSMENT_VERDICTS)[number];
export type FitAssessmentEligibilityStatus = (typeof FIT_ASSESSMENT_ELIGIBILITY)[number];
export type FitAssessmentEvidenceSource = (typeof FIT_ASSESSMENT_EVIDENCE_SOURCES)[number];
export type FitAssessmentInputChange = (typeof FIT_ASSESSMENT_INPUT_CHANGES)[number];

export type FitAssessmentMatch = {
  jobExcerpt: string;
  candidateSource: FitAssessmentEvidenceSource;
  candidateExcerpt: string;
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

export type FitAssessmentResult = {
  verdict: FitAssessmentVerdict;
  summary: string;
  matches: FitAssessmentMatch[];
  gaps: string[];
  eligibility?: {
    status: FitAssessmentEligibilityStatus;
    jobExcerpt?: string;
    candidateExcerpt?: string;
    note?: string;
  };
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

export type FitAssessmentState =
  | { status: "disabled" }
  | { status: "running"; resumeLabel: string }
  | {
      status: "ready";
      snapshot: FitAssessmentSnapshot;
      provenance: FitAssessmentProvenance;
      // Only the first assessment launched by Prepare may authorize the
      // optional automatic Polish actions. Later assessments stay advisory.
      autoPolishEligible: boolean;
    }
  // A tracker restore can show the compact result saved with that application,
  // but cannot reconstruct the exact candidate-context/request provenance. Keep
  // it historical so it never participates in current-input automation.
  | { status: "saved"; snapshot: FitAssessmentSnapshot }
  | { status: "stale"; snapshot: FitAssessmentSnapshot; changes: FitAssessmentInputChange[] }
  | { status: "unavailable"; resumeLabel: string; message: string };

const verdicts = new Set<string>(FIT_ASSESSMENT_VERDICTS);
const eligibilityStatuses = new Set<string>(FIT_ASSESSMENT_ELIGIBILITY);

function text(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function excerpt(value: unknown, maxLength = 500): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : "";
}

function excerptList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const cleaned = excerpt(item);
    const key = cleaned.toLocaleLowerCase().replace(/\s+/g, " ");
    if (!cleaned || seen.has(key)) return null;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function matchList(value: unknown): FitAssessmentMatch[] | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const seen = new Set<string>();
  const matches: FitAssessmentMatch[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const source = item as Record<string, unknown>;
    const jobExcerpt = excerpt(source.jobExcerpt);
    const candidateExcerpt = excerpt(source.candidateExcerpt);
    const candidateSource = text(source.candidateSource, 32).toUpperCase();
    const key = jobExcerpt.toLocaleLowerCase().replace(/\s+/g, " ");
    if (
      !jobExcerpt
      || !candidateExcerpt
      || !FIT_ASSESSMENT_EVIDENCE_SOURCES.includes(candidateSource as FitAssessmentEvidenceSource)
      || seen.has(key)
    ) return null;
    seen.add(key);
    matches.push({
      jobExcerpt,
      candidateSource: candidateSource as FitAssessmentEvidenceSource,
      candidateExcerpt
    });
  }
  return matches;
}

export function sanitizeFitAssessment(raw: unknown): FitAssessmentResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const verdict = text(source.verdict, 24).toUpperCase();
  if (!verdicts.has(verdict)) return null;
  const matches = matchList(source.matches);
  const gaps = excerptList(source.gaps);
  if (!matches || !gaps) return null;
  if (verdict !== "LIMITED" && matches.length === 0) return null;

  const rawEligibility = source.eligibility;
  let eligibility: FitAssessmentResult["eligibility"];
  if (rawEligibility !== undefined && rawEligibility !== null) {
    if (typeof rawEligibility !== "object" || Array.isArray(rawEligibility)) return null;
    const eligibilitySource = rawEligibility as Record<string, unknown>;
    const status = text(eligibilitySource.status, 16).toUpperCase();
    if (!eligibilityStatuses.has(status)) return null;
    const note = text(eligibilitySource.note, 240);
    const jobExcerpt = excerpt(eligibilitySource.jobExcerpt);
    const candidateExcerpt = excerpt(eligibilitySource.candidateExcerpt);
    if ((status === "CHECK" || status === "BLOCKED") && !jobExcerpt) return null;
    if (status === "BLOCKED" && !candidateExcerpt) return null;
    eligibility = {
      status: status as FitAssessmentEligibilityStatus,
      ...(jobExcerpt ? { jobExcerpt } : {}),
      ...(candidateExcerpt ? { candidateExcerpt } : {}),
      ...(note ? { note } : {})
    };
  }

  const typedVerdict = verdict as FitAssessmentVerdict;
  return {
    verdict: typedVerdict,
    summary: FIT_ASSESSMENT_SUMMARY[typedVerdict],
    matches,
    gaps,
    ...(eligibility ? { eligibility } : {})
  };
}
