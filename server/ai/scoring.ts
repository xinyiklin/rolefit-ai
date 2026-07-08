// Fit scoring + verdict arithmetic — the server does the math over
// reviewer-extracted evidence; split from sanitize.mjs. Anti-fabrication-critical:
// behavior changes require adversarial review.

import { clippedString, enumValue, COVERAGE_STATUSES } from "./sanitize.ts";
import { ELIGIBILITY_BLOCKER, SENIORITY_BUCKET_RE } from "./eligibilityLexicon.ts";

// The four scoring buckets (clarity is derived separately, not a coverage bucket).
type BucketName = "requiredTech" | "requiredDomains" | "seniority" | "preferred";
// Which coverage column a scoring pass reads.
type StatusField = "baseStatus" | "tailoredStatus";
// A sanitized requirement-coverage row (the shape sanitizeRequirementCoverage emits).
type RequirementRow = {
  bucket: BucketName;
  category: string;
  requirement: string;
  importance: string;
  baseStatus: string;
  tailoredStatus: string;
  baseEvidence: string;
  tailoredEvidence: string;
};
// The already-sanitized review object the caps/clarity math reads defensively.
type StrictReviewLike = {
  gaps?: Array<{ severity?: unknown }>;
  verdict?: string;
  riskFlags?: unknown[];
} | null | undefined;
// The base/tailored score pair the coverage arithmetic produces.
type AiScore = { base: number; tailored: number; liftReason: string };

const REQUIREMENT_IMPORTANCE = new Set(["critical", "high", "medium", "low"]);

function verdictForScore(score: number): string {
  if (score >= 85) return "STRONG FIT";
  if (score >= 70) return "REASONABLE FIT";
  if (score >= 46) return "STRETCH";
  return "DON'T APPLY";
}

// Per-bucket point maxima for the arithmetic fit score. Mirrors the weights in
// the strict-review scoring prompt.
const BUCKET_MAX: Record<string, number> = {
  requiredTech: 40,
  requiredDomains: 25,
  seniority: 15,
  preferred: 10,
  clarity: 10
};

const STATUS_POINTS: Record<string, number> = {
  covered: 1,
  adjacent: 0.45,
  missing: 0
};

const IMPORTANCE_POINTS: Record<string, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0.5
};

const MISSING_BUCKET_DEFAULTS: Record<string, number> = {
  requiredTech: 0.5,
  requiredDomains: 0.75,
  seniority: 0.75,
  preferred: 1
};

function requirementBucket(category: unknown): BucketName | null {
  const text = String(category ?? "").toLowerCase();
  if (/\bprefer|nice|bonus|plus\b/.test(text)) return "preferred";
  // Seniority-bucket terms share the credential-gate vocabulary — the regex
  // lives in the shared eligibility lexicon so a new gate term is added to all
  // three lists together (a term missing HERE silently drops its row from
  // scoring; see the lexicon header).
  if (SENIORITY_BUCKET_RE.test(text)) {
    return "seniority";
  }
  if (/\btech|skill|tool|language|framework|platform|stack\b/.test(text)) return "requiredTech";
  if (/\bexperience|domain|responsibilit|work|practice|project|deliver|build|design|develop\b/.test(text)) return "requiredDomains";
  return null;
}

function sanitizeRequirementCoverage(raw: unknown): RequirementRow[] {
  if (!Array.isArray(raw)) return [];
  const output: RequirementRow[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const requirement = clippedString(row.requirement ?? row.keyword ?? row.gap, 180);
    if (!requirement) continue;
    const category = clippedString(row.category, 80);
    const bucket = requirementBucket(category);
    if (!bucket) continue;
    const importance = enumValue(row.importance, REQUIREMENT_IMPORTANCE, bucket === "preferred" ? "low" : "medium");
    const baseStatus = enumValue(row.baseStatus ?? row.status, COVERAGE_STATUSES, "missing");
    const tailoredStatus = enumValue(row.tailoredStatus ?? row.status, COVERAGE_STATUSES, baseStatus);
    const key = `${bucket}:${requirement.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({
      bucket,
      category,
      requirement,
      importance,
      baseStatus,
      tailoredStatus,
      baseEvidence: clippedString(row.baseEvidence ?? row.where, 300),
      tailoredEvidence: clippedString(row.tailoredEvidence ?? row.where, 300)
    });
    if (output.length >= 20) break;
  }
  return output;
}

function scoreRequirementBucket(rows: RequirementRow[], bucket: BucketName, statusField: StatusField): number {
  const relevant = rows.filter((row) => row.bucket === bucket);
  if (!relevant.length) return Math.round(BUCKET_MAX[bucket] * MISSING_BUCKET_DEFAULTS[bucket]);
  let total = 0;
  let earned = 0;
  for (const row of relevant) {
    const weight = IMPORTANCE_POINTS[row.importance] ?? 1;
    total += weight;
    earned += weight * (STATUS_POINTS[row[statusField]] ?? 0);
  }
  return total ? Math.round(BUCKET_MAX[bucket] * (earned / total)) : 0;
}

function scoreRequirementClarity(rows: RequirementRow[], statusField: StatusField, strictReview: StrictReviewLike): number {
  const relevant = rows.filter((row) => row.bucket !== "preferred");
  if (!relevant.length) return 8;
  let total = 0;
  let earned = 0;
  for (const row of relevant) {
    const weight = IMPORTANCE_POINTS[row.importance] ?? 1;
    total += weight;
    earned += weight * (STATUS_POINTS[row[statusField]] ?? 0);
  }
  // Array.isArray(strictReview?.riskFlags) truthiness proves strictReview non-null.
  const riskPenalty = Math.min(3, Array.isArray(strictReview?.riskFlags) ? strictReview!.riskFlags!.length : 0);
  return Math.max(0, Math.min(10, Math.round(10 * (earned / Math.max(1, total))) - riskPenalty));
}

function scoreRequirements(rows: RequirementRow[], statusField: StatusField, strictReview: StrictReviewLike): number {
  return Math.min(100, (
    scoreRequirementBucket(rows, "requiredTech", statusField) +
    scoreRequirementBucket(rows, "requiredDomains", statusField) +
    scoreRequirementBucket(rows, "seniority", statusField) +
    scoreRequirementBucket(rows, "preferred", statusField) +
    scoreRequirementClarity(rows, statusField, strictReview)
  ));
}

function requirementLiftReason(rows: RequirementRow[]): string {
  const improved = rows
    .filter((row) => (STATUS_POINTS[row.tailoredStatus] ?? 0) > (STATUS_POINTS[row.baseStatus] ?? 0))
    .map((row) => row.requirement)
    .slice(0, 2);
  if (!improved.length) return "Tailoring did not materially change requirement coverage.";
  return `Tailoring improved evidence for ${improved.join(improved.length > 1 ? " and " : "")}.`;
}

// Primary strict-review scoring path: the model extracts requirement coverage,
// but the server owns every point calculation. This removes model-authored
// numeric bucket wobble while keeping the reviewer responsible for evidence
// classification.
export function scoreFromRequirementCoverage(rawCoverage: unknown, strictReview: StrictReviewLike): AiScore | null {
  const rows = sanitizeRequirementCoverage(rawCoverage);
  // Require enough rows that the score is based on an actual requirement table,
  // not one or two vague bullets. Fallback callers may still use legacy buckets.
  if (rows.length < 4) return null;
  return {
    base: scoreRequirements(rows, "baseStatus", strictReview),
    tailored: scoreRequirements(rows, "tailoredStatus", strictReview),
    liftReason: requirementLiftReason(rows)
  };
}

// Importance ordering for the user-visible coverage table: highest-impact rows
// first, so the client's "Coverage · N" list leads with the requirements that
// decide apply/skip. Unknown importances sort as "medium".
const DISPLAY_COVERAGE_IMPORTANCE_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// Derive the user-visible coverage table from the SAME requirementCoverage rows
// the score is built from. This REPLACES the model-authored strictReview.coverage
// array, which used to duplicate this data: the strict-review prompt asked the
// model to mirror tailoredStatus into a second array, but scoring never read it,
// so the display table could silently drift from the scored evidence. Now both the
// score and the display come from one requirementCoverage source.
//
// Each sanitized row maps to the client display shape { category, keyword, status,
// where } — keyword is the requirement text, and status/where are the TAILORED
// status/evidence (the reviewed resume after the proposed changes). Status enums
// are already coerced to the coverage vocabulary by sanitizeRequirementCoverage,
// and an empty tailoredEvidence passes through unchanged (matching the prior
// sanitizer's clipped-string behavior — empty is allowed). Rows are ordered
// critical→high→medium→low (stable within a tier) and capped at 12, mirroring the
// old prompt's "4-12 most important". Returns [] when coverage is unusable — the
// same empty fallback the old sanitizer produced when the model omitted coverage.
export function displayCoverageFromRequirements(rawCoverage: unknown) {
  const rows = sanitizeRequirementCoverage(rawCoverage).map((row, index) => ({ row, index }));
  rows.sort((a, b) => {
    const rank =
      (DISPLAY_COVERAGE_IMPORTANCE_ORDER[a.row.importance] ?? 2) -
      (DISPLAY_COVERAGE_IMPORTANCE_ORDER[b.row.importance] ?? 2);
    return rank !== 0 ? rank : a.index - b.index; // stable within a tier
  });
  return rows.slice(0, 12).map(({ row }) => ({
    category: row.category,
    keyword: row.requirement,
    status: row.tailoredStatus,
    where: row.tailoredEvidence
  }));
}

// ELIGIBILITY_BLOCKER (the hard-gate lexicon: clearance / work-auth / residency /
// license / cert / degree terms that force DON'T APPLY) lives in the shared
// eligibility lexicon (./eligibilityLexicon.ts) alongside the distiller's
// AUTH_STEMS and the seniority-bucket regex, so the three co-evolving term
// lists are updated together; its header documents each deliberate delta
// (EAD/naturaliz distill-only, license/degree blocker-only, false-positive
// boundary choices).

// The model often reports a hard eligibility blocker as a requirementCoverage
// ROW ("Active Secret clearance required", tailoredStatus "missing") rather than
// as a gap with severity BLOCKER. Without this, a role the candidate is formally
// ineligible for can score 80-90 / "Strong fit", defeating the prompt's hard-
// blocker guarantee. Returns true when ANY sanitized coverage row is an
// eligibility requirement (category or requirement text matches ELIGIBILITY_
// BLOCKER) that is strong-importance (critical/high) AND still MISSING after
// tailoring. Only a "missing" tailoredStatus escalates, so a satisfied
// requirement never caps.
export function coverageHasEligibilityBlocker(rawCoverage: unknown): boolean {
  if (!Array.isArray(rawCoverage)) return false;
  // Scan the RAW rows, NOT sanitizeRequirementCoverage's output: that helper
  // drops any row whose `category` does not match a scoring bucket, so a hard
  // gate filed under a non-bucketing label ("Eligibility", "Education",
  // "Compliance", "Legal", "Security") would never reach this test and the cap
  // would silently fail to fire. Read the same raw fields the sanitizer reads
  // (requirement/keyword/gap + category) and gate conservatively: an explicit
  // critical/high importance AND a still-"missing" tailored status, so a
  // satisfied or vaguely-rated requirement never over-caps an applicable role.
  return rawCoverage.some((row) => {
    if (!row || typeof row !== "object") return false;
    const requirement = String(row.requirement ?? row.keyword ?? row.gap ?? "");
    const category = String(row.category ?? "");
    if (!ELIGIBILITY_BLOCKER.test(`${category} ${requirement}`)) return false;
    const importance = enumValue(row.importance, REQUIREMENT_IMPORTANCE, "medium");
    if (importance !== "critical" && importance !== "high") return false;
    const tailoredStatus = enumValue(row.tailoredStatus ?? row.status, COVERAGE_STATUSES, "missing");
    return tailoredStatus === "missing";
  });
}

// The score is derived from requirementCoverage, but the HIGH-gap caps read the
// SEPARATE strictReview.gaps array — so a model can mark required rows "missing"
// in coverage (correctly lowering the score) while omitting them from gaps to
// escape the cap ladder, keeping a REASONABLE/STRONG band it shouldn't. This
// counts missing required requirements straight from the coverage table
// (critical/high importance, non-preferred bucket, still missing after tailoring)
// so applyGapCapsAndVerdict can cap on whichever source reports more. Hard
// eligibility gates are handled separately by coverageHasEligibilityBlocker.
export function missingRequiredFromCoverage(rawCoverage: unknown): number {
  return sanitizeRequirementCoverage(rawCoverage).filter((row) =>
    row.bucket !== "preferred" &&
    (row.importance === "critical" || row.importance === "high") &&
    row.tailoredStatus === "missing"
  ).length;
}

// Deterministic caps + verdict from the sanitized gaps the reviewer itself
// reported: a BLOCKER gap (clearance/license/degree-class) caps both scores in
// the DON'T APPLY band; a HIGH gap (missing required skill) caps below 70. The
// verdict is then a pure function of the capped tailored score — never a
// second model opinion that can disagree with the number.
//
// hasCoverageBlocker (default false to preserve every existing caller/signature)
// is the synthetic BLOCKER signal derived from the requirementCoverage table via
// coverageHasEligibilityBlocker: when true, cap=45 + DON'T APPLY fire exactly
// like a BLOCKER gap, so an eligibility gate reported only as a coverage row
// still governs fit.
// Single source for the server verdict reason when an unmet eligibility gate
// forces DON'T APPLY. Referenced by both applyGapCapsAndVerdict branches (the
// null-score path and the capped-score path) so the wording can never drift.
const ELIGIBILITY_BLOCKER_CAP_REASON =
  "Server verdict: a required eligibility gate is unmet, which forces DON'T APPLY.";

export function applyGapCapsAndVerdict(
  aiScore: AiScore | null,
  strictReview: StrictReviewLike,
  hasCoverageBlocker: boolean = false,
  coverageMissingCount: number = 0
) {
  // Array.isArray(strictReview?.gaps) truthiness proves strictReview non-null.
  const gaps = Array.isArray(strictReview?.gaps) ? strictReview!.gaps! : [];
  // A BLOCKER gap OR a synthetic eligibility blocker from the coverage table
  // (missing critical/high clearance/work-auth/license/cert/degree row) forces
  // the DON'T APPLY band, regardless of HIGH-gap count OR score availability.
  const hasBlocker = hasCoverageBlocker || gaps.some((gap) => gap.severity === "BLOCKER");
  if (!aiScore) {
    // No usable numeric score (the client falls back to the local engine score),
    // but a hard eligibility blocker must STILL force DON'T APPLY — otherwise a
    // sparse review (a clearance/work-auth/license/cert/degree gate reported with
    // too few coverage rows to score, and no numeric buckets) would inherit the
    // model's optimistic verdict for a role the candidate is formally ineligible
    // for. With no blocker, pass the sanitized verdict through unchanged.
    return {
      aiScore,
      verdict: hasBlocker ? "DON'T APPLY" : (strictReview?.verdict ?? null),
      capReason: hasBlocker ? ELIGIBILITY_BLOCKER_CAP_REASON : ""
    };
  }
  // Graduated HIGH-gap cap. A single missing required skill is near-universal on
  // an honest pass against an 8-15 skill JD; the old binary "any HIGH -> 69"
  // pinned otherwise-strong matches to the STRETCH ceiling, which is why almost
  // everything read STRETCH. Now the cap scales with how many required skills are
  // genuinely missing. A BLOCKER still forces DON'T APPLY (unchanged).
  // Reconcile the two model arrays: take the STRONGER missing-required signal —
  // a missing critical/high requirementCoverage row is at least as severe as a
  // HIGH gap — so the fit number can't be gamed by under-reporting gaps. Honest
  // replies (gaps and coverage agree) are unchanged; max() only bites when
  // coverage reports MORE missing than the gaps array did.
  const highGaps = Math.max(
    gaps.filter((gap) => gap.severity === "HIGH").length,
    coverageMissingCount
  );
  let cap = 100;
  if (highGaps >= 1) cap = 79; // 1 missing required skill: top of REASONABLE FIT
  if (highGaps >= 2) cap = 69; // 2: STRETCH ceiling (the old flat behavior)
  if (highGaps >= 3) cap = 60; // 3+: solidly STRETCH
  if (hasBlocker) cap = 45;
  const base = Math.min(aiScore.base, cap);
  const tailored = Math.min(aiScore.tailored, cap);
  if (cap < 100 && (base !== aiScore.base || tailored !== aiScore.tailored)) {
    console.warn("[ai] capped fit score for reported gaps", {
      cap,
      base: `${aiScore.base}->${base}`,
      tailored: `${aiScore.tailored}->${tailored}`
    });
  }
  // Deterministic, server-authored reason naming the mechanism that set the
  // verdict. Stated only from facts already in the sanitized review — a blocker's
  // presence, or the count of missing-required gaps that capped the score — so
  // no new claim enters the review. Consumed by the /api/polish route when the
  // server verdict overrides the model's, so the user never reads the model's
  // stale justification for a verdict it no longer holds.
  let capReason;
  if (hasBlocker) {
    capReason = ELIGIBILITY_BLOCKER_CAP_REASON;
  } else if (highGaps >= 1 && aiScore.tailored > cap) {
    // Only claim the cap when it actually bound; a score already below the cap
    // set its own band, and attributing it to the cap would misstate the cause.
    capReason = `Server verdict: ${highGaps} missing required qualification${highGaps === 1 ? "" : "s"} capped the fit score at ${cap}, setting the ${verdictForScore(tailored)} band.`;
  } else {
    capReason = `Server verdict: recomputed from requirement-coverage evidence to the ${verdictForScore(tailored)} band (score ${tailored}).`;
  }
  return { aiScore: { ...aiScore, base, tailored }, verdict: verdictForScore(tailored), capReason };
}
