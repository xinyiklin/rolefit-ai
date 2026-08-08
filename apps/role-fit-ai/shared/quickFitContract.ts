export const QUICK_FIT_VERDICTS = ["STRONG", "REASONABLE", "STRETCH", "LIMITED"] as const;
export const QUICK_FIT_ELIGIBILITY = ["CLEAR", "CHECK", "BLOCKED"] as const;
export const QUICK_FIT_BASIS_IMPORTANCE = ["CORE", "SUPPORTING"] as const;
export const QUICK_FIT_BASIS_COVERAGE = ["DIRECT", "ADJACENT", "NOT_SHOWN", "CONTRADICTED"] as const;
export const QUICK_FIT_EVIDENCE_SOURCES = ["RESUME", "CANDIDATE_CONTEXT"] as const;

export type QuickFitVerdict = (typeof QUICK_FIT_VERDICTS)[number];
export type QuickFitEligibilityStatus = (typeof QUICK_FIT_ELIGIBILITY)[number];
export type QuickFitBasisImportance = (typeof QUICK_FIT_BASIS_IMPORTANCE)[number];
export type QuickFitBasisCoverage = (typeof QUICK_FIT_BASIS_COVERAGE)[number];
export type QuickFitEvidenceSource = (typeof QUICK_FIT_EVIDENCE_SOURCES)[number];

// Server-selected material requirements supplied with an Initial Fit request.
// They are live request data only: the server revalidates every excerpt against
// the full posting, the provider assesses the closed ids, and missing rows fail
// conservatively as NOT_SHOWN.
export type QuickFitRequirementCandidate = {
  requirementId: string;
  sourceRequirement: string;
  importance: QuickFitBasisImportance;
  kind: "QUALIFICATION" | "RESPONSIBILITY";
};

// Provider-only calibration input. The server validates these anchors and
// derives the public result below; basis items never enter tracker persistence
// or the visible Initial Fit contract.
export type QuickFitBasisItem = {
  requirementId?: string;
  sourceRequirement: string;
  importance: QuickFitBasisImportance;
  coverage: QuickFitBasisCoverage;
  evidenceSource?: QuickFitEvidenceSource;
  evidenceExcerpt?: string;
};

type PreparedRequirementSection = "required" | "responsibility";

const REQUIREMENT_SECTION_HEADINGS = new Map<string, PreparedRequirementSection>([
  ["required qualifications", "required"],
  ["core responsibilities", "responsibility"]
] as const);

const REQUIREMENT_PLACEHOLDER = /^\[(?:manual input needed|not specified)[^\]]*\]$|^not specified$/i;

function preparedRequirementSections(preparedJobText: string): { required: string[]; responsibility: string[] } {
  const result = { required: [] as string[], responsibility: [] as string[] };
  let active: keyof typeof result | null = null;
  for (const rawLine of String(preparedJobText ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    const heading = line.replace(/:\s*$/, "").toLowerCase();
    if (REQUIREMENT_SECTION_HEADINGS.has(heading)) {
      active = REQUIREMENT_SECTION_HEADINGS.get(heading) ?? null;
      continue;
    }
    if (/^[A-Za-z][A-Za-z /&-]{2,60}:$/.test(line)) {
      active = null;
      continue;
    }
    if (!active) continue;
    const item = line
      .replace(/^\s*(?:[-*â€¢Â·â€£â—¦â–ªâ—â—‹]|(?:\d+)[.)])\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!item || REQUIREMENT_PLACEHOLDER.test(item)) continue;
    result[active].push(item.slice(0, 500));
  }
  return result;
}

function requiredMateriality(value: string): number {
  let score = 0;
  if (/\b(?:must|required|minimum|mandatory|at least)\b/i.test(value)) score += 4;
  if (/\b(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\+|plus)?\s+years?\b/i.test(value)) score += 3;
  if (/\b(?:degree|bachelor|master|doctorate|ph\.?d|license|licence|certification)\b/i.test(value)) score += 2;
  return score;
}

export function quickFitRequirementCandidatesFromPreparedJob(
  preparedJobText: string
): QuickFitRequirementCandidate[] {
  const sections = preparedRequirementSections(preparedJobText);
  const rankedRequired = sections.required
    .map((sourceRequirement, index) => ({ sourceRequirement, index, score: requiredMateriality(sourceRequirement) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 6)
    .map(({ sourceRequirement }) => ({ sourceRequirement, kind: "QUALIFICATION" as const }));
  const responsibilities = sections.responsibility
    .slice(0, 6)
    .map((sourceRequirement) => ({ sourceRequirement, kind: "RESPONSIBILITY" as const }));
  return [...rankedRequired, ...responsibilities].slice(0, 12).map(({ sourceRequirement, kind }, index) => ({
    requirementId: `candidate-${index + 1}`,
    sourceRequirement,
    importance: "CORE",
    kind
  }));
}

export function quickFitRequirementIsEmploymentEligibility(requirement: string): boolean {
  return /\b(?:citizens?(?:hip)?|visa|sponsor(?:ship)?|work authoriz\w*|work authoris\w*|authoriz\w* to work|authoris\w* to work|green card|permanent resident|security clearance|ts\/sci|polygraph)\b/i.test(requirement);
}

// The provider sees five authoritative material requirements, not an arbitrary
// prefix. Preserve a minimum responsibility representation whenever the brief
// contains it, while never letting qualifications crowd above three slots.
export function selectQuickFitRequirements(
  candidates: QuickFitRequirementCandidate[]
): QuickFitRequirementCandidate[] {
  const seen = new Set<string>();
  const usable = candidates.filter((candidate) => {
    const key = candidate.sourceRequirement.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seen.has(key) || quickFitRequirementIsEmploymentEligibility(candidate.sourceRequirement)) return false;
    seen.add(key);
    return true;
  });
  const qualifications = usable.filter((candidate) => candidate.kind === "QUALIFICATION").slice(0, 3);
  const responsibilities = usable.filter((candidate) => candidate.kind === "RESPONSIBILITY");
  const selected = [...responsibilities.slice(0, 2), ...qualifications];
  for (const candidate of responsibilities.slice(2)) {
    if (selected.length === 5) break;
    selected.push(candidate);
  }
  return selected.slice(0, 5);
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

// What the screening actually ran against. A friendly label cannot answer that:
// two files can share one, editing a document never changes it, and re-preparing
// a posting leaves the old label attached to a fit that no longer applies. This
// is live workflow state only — the persisted snapshot above is unchanged.
export type QuickFitProvenance = {
  resumeFingerprint: string;
  jobFingerprint: string;
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
