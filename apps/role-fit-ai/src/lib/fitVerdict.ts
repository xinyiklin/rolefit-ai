// Single source of truth for the FIT VERDICT vocabulary, shared by every
// surface that shows fit (resume header band, review rail pill, application
// tracker). Before this, the tracker re-derived a separate "match" vocabulary
// (fitLabel: Strong/Good/Stretch/Weak match) from the stored score while the
// review pane showed the strict-review verdict (Strong fit / Reasonable fit /
// Stretch / Don't apply) — same band, different words, read as a mismatch.
//
// Rule: prefer a real stored/AI verdict; otherwise derive the verdict from the
// score using thresholds that MIRROR the server's verdictForScore (and the
// fitTone bands in applicationDisplay.ts). Label AND tone always come from the
// SAME verdict so they can never disagree within one surface.

import type { StrictReviewVerdict } from "../resume/types";

export const VERDICT_LABEL: Record<StrictReviewVerdict, string> = {
  "STRONG FIT": "Strong fit",
  "REASONABLE FIT": "Reasonable fit",
  STRETCH: "Stretch",
  "DON'T APPLY": "Don't apply"
};

// Tone keys match the existing .application-fit--* and fit color classes.
export const VERDICT_TONE: Record<StrictReviewVerdict, "strong" | "good" | "stretch" | "weak"> = {
  "STRONG FIT": "strong",
  "REASONABLE FIT": "good",
  STRETCH: "stretch",
  "DON'T APPLY": "weak"
};

// Score → verdict. Thresholds MIRROR server/ai/sanitize.ts verdictForScore
// (STRONG FIT >=85, REASONABLE FIT >=70, STRETCH >=46, DON'T APPLY <46) and the
// fitLabel/fitTone bands. Keep all three in sync — the server and client
// modules can't import each other.
export function verdictFromScore(score: number | null | undefined): StrictReviewVerdict | null {
  if (typeof score !== "number") return null;
  if (score >= 85) return "STRONG FIT";
  if (score >= 70) return "REASONABLE FIT";
  if (score >= 46) return "STRETCH";
  return "DON'T APPLY";
}

// CSS modifier for the rail/header verdict-pill, built from the verdict string
// the same way ReviewRail does ("DON'T APPLY" -> "don-t-apply").
export function verdictPillClass(verdict: StrictReviewVerdict): string {
  return `verdict-pill--${verdict.replace(/['\s]+/g, "-").toLowerCase()}`;
}
