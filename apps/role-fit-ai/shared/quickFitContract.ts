export const QUICK_FIT_VERDICTS = ["STRONG", "REASONABLE", "STRETCH", "LIMITED"] as const;
export const QUICK_FIT_ELIGIBILITY = ["CLEAR", "CHECK", "BLOCKED"] as const;
export const QUICK_FIT_EVIDENCE_SOURCES = ["RESUME", "CANDIDATE_CONTEXT"] as const;
export const QUICK_FIT_PROMPT_VERSION = "initial-fit-direct-rubric-v2";

export type QuickFitVerdict = (typeof QUICK_FIT_VERDICTS)[number];
export type QuickFitEligibilityStatus = (typeof QUICK_FIT_ELIGIBILITY)[number];
export type QuickFitEvidenceSource = (typeof QUICK_FIT_EVIDENCE_SOURCES)[number];
export type AutoPolishThreshold = QuickFitVerdict;

export const QUICK_FIT_SUMMARY: Record<QuickFitVerdict, string> = {
  STRONG: "Your background aligns closely with the role’s main requirements.",
  REASONABLE: "Your background aligns well, with a few material gaps.",
  STRETCH: "You have relevant experience, but several important gaps remain.",
  LIMITED: "The resume shows limited direct evidence for the role’s main requirements."
};

export const AUTO_POLISH_THRESHOLD_OPTIONS: ReadonlyArray<{
  value: AutoPolishThreshold;
  label: string;
}> = [
  { value: "STRONG", label: "Strong only" },
  { value: "REASONABLE", label: "Reasonable or better" },
  { value: "STRETCH", label: "Stretch or better" },
  { value: "LIMITED", label: "Any fit result" }
];

const FIT_RANK: Record<QuickFitVerdict, number> = {
  LIMITED: 0,
  STRETCH: 1,
  REASONABLE: 2,
  STRONG: 3
};

export function quickFitMeetsThreshold(
  verdict: QuickFitVerdict,
  threshold: AutoPolishThreshold
): boolean {
  return FIT_RANK[verdict] >= FIT_RANK[threshold];
}

// Initial Fit uses the same canonical text on the client and server. Friendly
// file labels stay outside this boundary because renaming a file does not
// change what was screened.
export function normalizeQuickFitInput(value: unknown): string {
  return String(value ?? "").normalize("NFKC").replace(/\r\n?/g, "\n").trim();
}

export type QuickFitResult = {
  verdict: QuickFitVerdict;
  summary: string;
  matches: string[];
  gaps: string[];
  eligibility?: {
    status: QuickFitEligibilityStatus;
    note?: string;
  };
};

export type QuickFitSnapshot = {
  result: QuickFitResult;
  resumeLabel: string;
};

export type QuickFitProvenance = {
  screeningJobFingerprint: string;
  resumeFingerprint: string;
  candidateContextFingerprint: string;
  requestIdentityFingerprint: string;
  inputFingerprint: string;
};

export type QuickFitState =
  | { status: "disabled" }
  | { status: "running"; resumeLabel: string }
  | { status: "ready"; snapshot: QuickFitSnapshot; provenance: QuickFitProvenance }
  | { status: "stale"; resumeLabel: string; message: string }
  | { status: "unavailable"; resumeLabel: string; message: string };

const verdicts = new Set<string>(QUICK_FIT_VERDICTS);
const eligibilityStatuses = new Set<string>(QUICK_FIT_ELIGIBILITY);

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

export function sanitizeQuickFit(raw: unknown): QuickFitResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const verdict = text(source.verdict, 24).toUpperCase();
  if (!verdicts.has(verdict)) return null;
  const matches = list(source.matches);
  const gaps = list(source.gaps);
  if (!matches || !gaps) return null;

  const rawEligibility = source.eligibility;
  let eligibility: QuickFitResult["eligibility"];
  if (rawEligibility !== undefined && rawEligibility !== null) {
    if (typeof rawEligibility !== "object" || Array.isArray(rawEligibility)) return null;
    const eligibilitySource = rawEligibility as Record<string, unknown>;
    const status = text(eligibilitySource.status, 16).toUpperCase();
    if (!eligibilityStatuses.has(status)) return null;
    const note = text(eligibilitySource.note, 240);
    eligibility = {
      status: status as QuickFitEligibilityStatus,
      ...(note ? { note } : {})
    };
  }

  const typedVerdict = verdict as QuickFitVerdict;
  return {
    verdict: typedVerdict,
    summary: QUICK_FIT_SUMMARY[typedVerdict],
    matches,
    gaps,
    ...(eligibility ? { eligibility } : {})
  };
}
