// Per-stage AI usage attribution, captured across Job analysis/Resume Polish/
// cover pipeline and snapshotted onto an Application at Apply time (see
// useApplications.ts's Application.aiUsage). Whole-map-replace semantics: an
// incoming aiUsage snapshot always wins on upsert — no deep per-stage merge.
//
// Stage keys are plain strings ("job-analysis" | "resume-polish" |
// "resume-polish-review" | "cover-polish" today) so a future stage can be added
// without a schema migration; the server sanitizer constrains keys to
// /^[a-z][a-z0-9-]{0,23}$/.

export type StageAiUsage = {
  // What produced the ACCEPTED output; "none" = stage skipped / completed
  // without running.
  source: "ai" | "local" | "none";
  // Actual producer — meaningful when source === "ai".
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  // Configured provider/model when source !== "ai" (what was attempted or
  // would have been used, for a fallback or a not-yet-run stage).
  requestedProvider?: string;
  requestedModel?: string;
  // Provider call attempts including internal retry.
  attempts?: number;
  // AI was attempted but the local output was accepted instead.
  fallback?: boolean;
  completedAt?: string;
};

export type ApplicationAiUsage = Record<string, StageAiUsage>;

export const RESUME_POLISH_REVIEW_USAGE_KEY = "resume-polish-review";

// The opt-in Polish review's receipt follows the run it belongs to: a run without
// a review clears it, so an earlier review never attaches to a later Apply. The
// review runs on the Resume Polish stage's own provider, model, and effort.
export function withReviewUsage(
  usage: ApplicationAiUsage,
  review?: { outcome: "REVIEWED" | "UNAVAILABLE"; attempts: number }
): ApplicationAiUsage {
  const rest = { ...usage };
  delete rest[RESUME_POLISH_REVIEW_USAGE_KEY];
  if (!review) return rest;
  const { provider, model, reasoningEffort, completedAt } = usage["resume-polish"] ?? {};
  const receipt: StageAiUsage = review.outcome === "REVIEWED"
    ? { source: "ai", provider, model, reasoningEffort, attempts: review.attempts, completedAt }
    : { source: "none", requestedProvider: provider, requestedModel: model, attempts: review.attempts, completedAt };
  return {
    ...rest,
    [RESUME_POLISH_REVIEW_USAGE_KEY]: Object.fromEntries(Object.entries(receipt).filter(([, value]) => value !== undefined)) as StageAiUsage
  };
}

// Copy at read/merge boundaries so callers can add current stage receipts
// without mutating a stored application or recovery draft. Records saved before
// the 2026-09-29 stage rename keep cover-letter usage under "cover".
export function copyAiUsage(
  usage: ApplicationAiUsage | undefined
): ApplicationAiUsage {
  const { cover, ...copy } = usage ?? {};
  return cover && !copy["cover-polish"] ? { ...copy, "cover-polish": cover } : copy;
}
