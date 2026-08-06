// Canonical fit vocabulary shared by the client, the loopback server, and the
// offline evals. Four fit levels are deliberate: a model cannot tell finer tiers
// ("Excellent", "Good", "Borderline") apart consistently, and adding them would
// recreate the false precision of the 0-100 score this vocabulary replaces.
// Nuance belongs to the separate confidence, eligibility, and recommendation
// fields below, not to more fit levels.

export type FitVerdict =
  | "STRONG_FIT"
  | "REASONABLE_FIT"
  | "STRETCH"
  | "LIMITED_FIT";

// Strongest first; the index is the sort rank for tracker ordering.
export const FIT_VERDICTS = [
  "STRONG_FIT",
  "REASONABLE_FIT",
  "STRETCH",
  "LIMITED_FIT"
] as const satisfies readonly FitVerdict[];

// How reliable and complete the INPUTS behind a verdict are — never how
// qualified the applicant is.
export type AssessmentConfidence = "HIGH" | "MEDIUM" | "LOW";

// Kept separate from capability fit: "Strong fit · Eligibility not satisfied" is
// a real combination (well qualified, but the posting requires citizenship).
// Absent candidate facts are UNCERTAIN, never NOT_SATISFIED.
export type EligibilityStatus = "SATISFIED" | "UNCERTAIN" | "NOT_SATISFIED";

// AI Review owns this recommendation. The shared contract defines its wire
// vocabulary for validation; it never derives a replacement from other fields.
export type ApplicationRecommendation =
  | "APPLY"
  | "TAILOR_FIRST"
  | "CONFIRM_ELIGIBILITY"
  | "APPLY_SELECTIVELY"
  | "NOT_RECOMMENDED";

// Lifecycle of the audit itself. NEEDS_INFORMATION is not a fifth verdict — it
// means the inputs cannot support an honest assessment at all.
export type FitAuditStatus =
  | "WAITING_FOR_JOB"
  | "WAITING_FOR_RESUME"
  | "ASSESSING"
  | "NEEDS_INFORMATION"
  | "READY"
  | "STALE"
  | "FAILED";

// The final Resume audit answers a different question than fit ("is this exact
// document ready to submit?"), so it gets its own scale rather than a second
// competing fit verdict.
export type SubmissionReadiness =
  | "READY"
  | "REVISIONS_RECOMMENDED"
  | "EVIDENCE_NEEDED"
  | "NOT_READY";

export type RequirementCategory =
  | "REQUIRED_TECH"
  | "REQUIRED_EXPERIENCE"
  | "REQUIRED_YEARS"
  | "REQUIRED_EDUCATION"
  | "ELIGIBILITY"
  | "CORE_RESPONSIBILITY"
  | "PREFERRED";

export type RequirementStatus = "COVERED" | "ADJACENT" | "MISSING" | "UNCERTAIN";

export type RequirementImportance = "CORE" | "SUPPORTING";

// One canonical row per requirement. Independent coverage and gap lists could
// contradict each other — the same requirement appearing as both covered and
// missing — so every surface derives from this single array instead.
export type RequirementAssessment = {
  requirementId: string;
  sourceRequirementId: string;
  requirement: string;
  category: RequirementCategory;
  status: RequirementStatus;
  importance: RequirementImportance;
  evidenceIds: string[];
  explanation: string;
  canSurfaceInResume: boolean;
};

const FIT_VERDICT_SET: ReadonlySet<string> = new Set(FIT_VERDICTS);

export function normalizeFitVerdict(value: unknown): FitVerdict | null {
  return typeof value === "string" && FIT_VERDICT_SET.has(value)
    ? (value as FitVerdict)
    : null;
}

export function fitVerdictRank(verdict: FitVerdict): number {
  return FIT_VERDICTS.indexOf(verdict);
}

// Retired vocabulary, still present in saved application records. "Don't apply"
// was a recommendation wearing a fit label: a user may knowingly apply to a
// limited-fit role for a referral, a narrow applicant pool, or personal
// interest, so it maps to LIMITED_FIT and the advice moves to the
// recommendation field.
export type LegacyFitVerdict =
  | "STRONG FIT"
  | "REASONABLE FIT"
  | "STRETCH"
  | "DON'T APPLY";

export const LEGACY_VERDICT_TOKEN: Record<FitVerdict, LegacyFitVerdict> = {
  STRONG_FIT: "STRONG FIT",
  REASONABLE_FIT: "REASONABLE FIT",
  STRETCH: "STRETCH",
  LIMITED_FIT: "DON'T APPLY"
};

export function normalizeLegacyVerdict(value: unknown): FitVerdict | null {
  if (value === "STRONG FIT") return "STRONG_FIT";
  if (value === "REASONABLE FIT") return "REASONABLE_FIT";
  if (value === "STRETCH") return "STRETCH";
  if (value === "DON'T APPLY") return "LIMITED_FIT";
  return null;
}

// Saved records may hold either vocabulary while the migration lands, so
// restore paths read through one accessor rather than guessing per call site.
export function readStoredFitVerdict(value: unknown): FitVerdict | null {
  return normalizeFitVerdict(value) ?? normalizeLegacyVerdict(value);
}

// Score bands for LEGACY records only. Nothing new writes a score; this exists
// so an application saved before the vocabulary change still resolves to a
// label instead of reading as unassessed.
export const LEGACY_FIT_SCORE_FLOOR: Record<
  Exclude<FitVerdict, "LIMITED_FIT">,
  number
> = {
  STRONG_FIT: 85,
  REASONABLE_FIT: 70,
  STRETCH: 46
};

export function fitVerdictFromLegacyScore(
  score: number | null | undefined
): FitVerdict | null {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  if (score >= LEGACY_FIT_SCORE_FLOOR.STRONG_FIT) return "STRONG_FIT";
  if (score >= LEGACY_FIT_SCORE_FLOOR.REASONABLE_FIT) return "REASONABLE_FIT";
  if (score >= LEGACY_FIT_SCORE_FLOOR.STRETCH) return "STRETCH";
  return "LIMITED_FIT";
}

// Derived views over the one requirement array. Kept here (not in each surface)
// so "covered" and "missing" cannot drift into overlapping definitions.
function assertUniqueRequirementIds(
  requirements: readonly RequirementAssessment[]
): void {
  const seen = new Set<string>();
  for (const item of requirements) {
    if (seen.has(item.requirementId)) {
      throw new TypeError(`duplicate requirementId "${item.requirementId}"`);
    }
    seen.add(item.requirementId);
  }
}

export function strongestMatches(
  requirements: readonly RequirementAssessment[]
): RequirementAssessment[] {
  assertUniqueRequirementIds(requirements);
  return requirements.filter((item) => item.status === "COVERED");
}

export function importantGaps(
  requirements: readonly RequirementAssessment[]
): RequirementAssessment[] {
  assertUniqueRequirementIds(requirements);
  return requirements.filter(
    (item) =>
      item.importance === "CORE" &&
      (item.status === "MISSING" || item.status === "ADJACENT")
  );
}

export function uncertainRequirements(
  requirements: readonly RequirementAssessment[]
): RequirementAssessment[] {
  assertUniqueRequirementIds(requirements);
  return requirements.filter((item) => item.status === "UNCERTAIN");
}
