import type { StrictReviewVerdict } from "../resume/types.ts";

export const AUTO_POLISH_THRESHOLDS = [
  "off",
  "STRETCH",
  "REASONABLE FIT",
  "STRONG FIT"
] as const;

export type AutoPolishThreshold = (typeof AUTO_POLISH_THRESHOLDS)[number];

const AUTO_POLISH_THRESHOLD_SET: ReadonlySet<unknown> = new Set(AUTO_POLISH_THRESHOLDS);

// Higher is a stronger fit. The comparison stays categorical so automation
// follows the model-authored verdict instead of inventing a second score rule.
const VERDICT_RANK: Record<StrictReviewVerdict, number> = {
  "DON'T APPLY": 0,
  STRETCH: 1,
  "REASONABLE FIT": 2,
  "STRONG FIT": 3
};

export function isAutoPolishThreshold(value: unknown): value is AutoPolishThreshold {
  return AUTO_POLISH_THRESHOLD_SET.has(value);
}

export function meetsAutoPolishThreshold(
  verdict: StrictReviewVerdict,
  threshold: AutoPolishThreshold
): boolean {
  return threshold !== "off" && VERDICT_RANK[verdict] >= VERDICT_RANK[threshold];
}
