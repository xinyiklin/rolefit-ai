import type { FitAssessmentVerdict } from "../../shared/fitAssessmentContract.ts";

export type AutoPolishThreshold = FitAssessmentVerdict;

export const AUTO_POLISH_THRESHOLD_OPTIONS: ReadonlyArray<{
  value: AutoPolishThreshold;
  label: string;
}> = [
  { value: "STRONG", label: "Strong only" },
  { value: "REASONABLE", label: "Reasonable or better" },
  { value: "STRETCH", label: "Stretch or better" },
  { value: "LIMITED", label: "Any fit result" }
];

const FIT_RANK: Record<FitAssessmentVerdict, number> = {
  LIMITED: 0,
  STRETCH: 1,
  REASONABLE: 2,
  STRONG: 3
};

export function fitAssessmentMeetsThreshold(
  verdict: FitAssessmentVerdict,
  threshold: AutoPolishThreshold
): boolean {
  return FIT_RANK[verdict] >= FIT_RANK[threshold];
}

export type AutomaticPolishActionDecision = "start" | "wait" | "decline";

export function automaticPolishActionDecision({
  enabled,
  thresholdMet,
  automationBlocked,
  prerequisitePending,
  canStart
}: {
  enabled: boolean;
  thresholdMet: boolean;
  automationBlocked: boolean;
  prerequisitePending: boolean;
  canStart: boolean;
}): AutomaticPolishActionDecision {
  if (!enabled || !thresholdMet || automationBlocked) return "decline";
  if (prerequisitePending) return "wait";
  return canStart ? "start" : "decline";
}
