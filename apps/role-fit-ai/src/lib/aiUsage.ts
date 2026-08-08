// Per-stage AI usage attribution, captured across Job analysis/tailor/Final Check/
// cover pipeline and snapshotted onto an Application at Apply time (see
// useApplications.ts's Application.aiUsage). Whole-map-replace semantics: an
// incoming aiUsage snapshot always wins on upsert — no deep per-stage merge.
//
// Stage keys are plain strings ("job-analysis" | "tailor" | "final-check" | "cover" today)
// so a future stage can be added without a schema migration; the server sanitizer
// constrains keys to /^[a-z][a-z0-9-]{0,23}$/.

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

// Canonicalize historical stage names at client read/merge boundaries. A
// canonical value wins if both old and new keys are present.
export function canonicalizeAiUsageStageKeys(
  usage: ApplicationAiUsage | undefined
): ApplicationAiUsage {
  const canonical = { ...(usage ?? {}) };
  if (!canonical["job-analysis"] && canonical.distill) {
    canonical["job-analysis"] = canonical.distill;
  }
  if (!canonical["final-check"] && canonical.review) {
    canonical["final-check"] = canonical.review;
  }
  delete canonical.distill;
  delete canonical.review;
  return canonical;
}
