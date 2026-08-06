// LEGACY fit-verdict surface: the four stored strings that saved records hold
// and the strict-review model still emits. The current vocabulary is FitVerdict
// in shared/fitAssessmentContract.ts, where "DON'T APPLY" is LIMITED_FIT. This
// module stays on the legacy strings until the display and persistence
// migrations land.
//
// It exists because the tracker once re-derived its own vocabulary (fitLabel:
// Strong/Good/Stretch/Weak match) from the stored score while the review pane
// showed the strict-review verdict — same band, different words, read as a
// mismatch. Label AND tone therefore always come from the SAME verdict, and
// a real stored/AI verdict is preferred over anything derived from a score.

import {
  LEGACY_VERDICT_TOKEN,
  fitVerdictFromLegacyScore
} from "../../shared/fitAssessmentContract.ts";
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

// Score → verdict for records saved before the vocabulary change. The bands
// (>=85, >=70, >=46) come from fitVerdictFromLegacyScore, but four hardcoded
// copies still exist and must stay in step until they read the shared floors:
// sanitize.ts's band check, fitTone and priorityFor in applicationDisplay.ts,
// and the reason bands in verdictReason.ts.
export function verdictFromScore(score: number | null | undefined): StrictReviewVerdict | null {
  const verdict = fitVerdictFromLegacyScore(score);
  return verdict ? LEGACY_VERDICT_TOKEN[verdict] : null;
}

// CSS modifier for the rail/header verdict-pill, built from the verdict string
// the same way ReviewRail does ("DON'T APPLY" -> "don-t-apply").
export function verdictPillClass(verdict: StrictReviewVerdict): string {
  return `verdict-pill--${verdict.replace(/['\s]+/g, "-").toLowerCase()}`;
}
