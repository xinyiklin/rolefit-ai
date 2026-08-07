// Per-stage AI usage attribution, captured across Job analysis/Initial Fit/tailor/review/
// cover pipeline and snapshotted onto an Application at Apply time (see
// useApplications.ts's Application.aiUsage). Whole-map-replace semantics: an
// incoming aiUsage snapshot always wins on upsert — no deep per-stage merge.
//
// Stage keys are plain strings ("job-analysis" | "initial-fit" | "tailor" | "review" | "cover" today)
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

// Historical applications used `distill`. Canonicalize at client read/merge
// boundaries so the UI labels those records as Job analysis and every later
// write emits only the new key. A canonical value wins if both are present.
export function canonicalizeAiUsageStageKeys(
  usage: ApplicationAiUsage | undefined
): ApplicationAiUsage {
  const canonical = { ...(usage ?? {}) };
  if (!canonical["job-analysis"] && canonical.distill) {
    canonical["job-analysis"] = canonical.distill;
  }
  delete canonical.distill;
  return canonical;
}
