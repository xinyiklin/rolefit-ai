export const QUICK_FIT_VERDICTS = ["STRONG", "REASONABLE", "STRETCH", "LIMITED"] as const;
export const QUICK_FIT_ELIGIBILITY = ["CLEAR", "CHECK", "BLOCKED"] as const;

export type QuickFitVerdict = (typeof QUICK_FIT_VERDICTS)[number];
export type QuickFitEligibilityStatus = (typeof QUICK_FIT_ELIGIBILITY)[number];

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

export type QuickFitState =
  | { status: "disabled" }
  | { status: "running"; resumeLabel: string }
  | { status: "ready"; snapshot: QuickFitSnapshot }
  | { status: "unavailable"; resumeLabel: string; message: string };

const verdicts = new Set<string>(QUICK_FIT_VERDICTS);
const eligibilityStatuses = new Set<string>(QUICK_FIT_ELIGIBILITY);

function text(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function list(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const cleaned = text(item, 220).replace(/^[\s•·‣◦▪●○*\-–—]+/, "").trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length === 3) break;
  }
  return result;
}

export function sanitizeQuickFit(raw: unknown): QuickFitResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const verdict = text(source.verdict, 24).toUpperCase();
  const summary = text(source.summary, 320);
  if (!verdicts.has(verdict) || !summary) return null;

  const rawEligibility = source.eligibility;
  let eligibility: QuickFitResult["eligibility"];
  if (rawEligibility && typeof rawEligibility === "object" && !Array.isArray(rawEligibility)) {
    const eligibilitySource = rawEligibility as Record<string, unknown>;
    const status = text(eligibilitySource.status, 16).toUpperCase();
    if (eligibilityStatuses.has(status)) {
      const note = text(eligibilitySource.note, 240);
      eligibility = {
        status: status as QuickFitEligibilityStatus,
        ...(note ? { note } : {})
      };
    }
  }

  return {
    verdict: verdict as QuickFitVerdict,
    summary,
    matches: list(source.matches),
    gaps: list(source.gaps),
    ...(eligibility ? { eligibility } : {})
  };
}

export function quickFitAllowsAutoProposal(result: QuickFitResult): boolean {
  return (
    (result.verdict === "STRONG" || result.verdict === "REASONABLE") &&
    result.eligibility?.status !== "BLOCKED"
  );
}
