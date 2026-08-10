export const FIT_ASSESSMENT_VERDICTS = ["STRONG", "REASONABLE", "STRETCH", "LIMITED"] as const;
export const FIT_ASSESSMENT_ELIGIBILITY = ["CLEAR", "CHECK", "BLOCKED"] as const;
export const FIT_ASSESSMENT_EVIDENCE_SOURCES = ["RESUME", "CANDIDATE_CONTEXT"] as const;
export const FIT_ASSESSMENT_INPUT_CHANGES = ["job", "resume", "candidate-context", "settings"] as const;
export const FIT_ASSESSMENT_PROMPT_VERSION = "fit-assessment-direct-rubric-v3";

export type FitAssessmentVerdict = (typeof FIT_ASSESSMENT_VERDICTS)[number];
export type FitAssessmentEligibilityStatus = (typeof FIT_ASSESSMENT_ELIGIBILITY)[number];
export type FitAssessmentEvidenceSource = (typeof FIT_ASSESSMENT_EVIDENCE_SOURCES)[number];
export type FitAssessmentInputChange = (typeof FIT_ASSESSMENT_INPUT_CHANGES)[number];

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
  matches: string[];
  gaps: string[];
  eligibility?: {
    status: FitAssessmentEligibilityStatus;
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

function list(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const cleaned = text(item, 500).replace(/^[\s•·‣◦▪●○*\-–—]+/, "").trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) return null;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

export function sanitizeFitAssessment(raw: unknown): FitAssessmentResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const verdict = text(source.verdict, 24).toUpperCase();
  if (!verdicts.has(verdict)) return null;
  const matches = list(source.matches);
  const gaps = list(source.gaps);
  if (!matches || !gaps) return null;

  const rawEligibility = source.eligibility;
  let eligibility: FitAssessmentResult["eligibility"];
  if (rawEligibility !== undefined && rawEligibility !== null) {
    if (typeof rawEligibility !== "object" || Array.isArray(rawEligibility)) return null;
    const eligibilitySource = rawEligibility as Record<string, unknown>;
    const status = text(eligibilitySource.status, 16).toUpperCase();
    if (!eligibilityStatuses.has(status)) return null;
    const note = text(eligibilitySource.note, 240);
    eligibility = {
      status: status as FitAssessmentEligibilityStatus,
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
