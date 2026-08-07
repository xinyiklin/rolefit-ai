import type { FitVerdict } from "../../shared/fitAssessmentContract.ts";

export const VERDICT_LABEL: Record<FitVerdict, string> = {
  STRONG_FIT: "Strong fit",
  REASONABLE_FIT: "Reasonable fit",
  STRETCH: "Stretch",
  LIMITED_FIT: "Limited fit"
};

export const VERDICT_TONE: Record<FitVerdict, "strong" | "good" | "stretch" | "weak"> = {
  STRONG_FIT: "strong",
  REASONABLE_FIT: "good",
  STRETCH: "stretch",
  LIMITED_FIT: "weak"
};

export const FIT_VERDICT_RANK: Record<FitVerdict, number> = {
  LIMITED_FIT: 0,
  STRETCH: 1,
  REASONABLE_FIT: 2,
  STRONG_FIT: 3
};

export function verdictPillClass(verdict: FitVerdict): string {
  return `verdict-pill--${verdict.replace(/_/g, "-").toLowerCase()}`;
}
