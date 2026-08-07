import type {
  FitAssessment,
  FitVerdict
} from "../../shared/fitAssessmentContract.ts";
import { FIT_VERDICT_RANK } from "./fitVerdict.ts";

export const AUTO_POLISH_THRESHOLDS = [
  "OFF",
  "STRETCH",
  "REASONABLE_FIT",
  "STRONG_FIT"
] as const;

export type AutoPolishThreshold = (typeof AUTO_POLISH_THRESHOLDS)[number];

const AUTO_POLISH_THRESHOLD_SET: ReadonlySet<unknown> = new Set(AUTO_POLISH_THRESHOLDS);

export type AutoPolishDecision =
  | { action: "RUN"; reason: string }
  | { action: "WAIT"; reason: string }
  | { action: "SKIP"; reason: string };

export function isAutoPolishThreshold(value: unknown): value is AutoPolishThreshold {
  return AUTO_POLISH_THRESHOLD_SET.has(value);
}

export function meetsAutoPolishThreshold(
  verdict: FitVerdict,
  threshold: AutoPolishThreshold
): boolean {
  return threshold !== "OFF" && FIT_VERDICT_RANK[verdict] >= FIT_VERDICT_RANK[threshold];
}

export function decideAutoPolish(
  assessment: FitAssessment,
  threshold: AutoPolishThreshold
): AutoPolishDecision {
  if (threshold === "OFF") return { action: "SKIP", reason: "Disabled in Settings." };
  if (assessment.confidence === "LOW") {
    return { action: "WAIT", reason: "Initial Fit has low confidence; review it before polishing." };
  }
  if (assessment.eligibility.status === "NOT_SATISFIED") {
    return { action: "SKIP", reason: "A required eligibility condition is not satisfied." };
  }
  if (assessment.eligibility.status === "UNCERTAIN") {
    return { action: "WAIT", reason: "Confirm the unresolved eligibility conditions before polishing." };
  }
  if (!meetsAutoPolishThreshold(assessment.verdict, threshold)) {
    return { action: "SKIP", reason: "Initial Fit is below the configured threshold." };
  }
  return { action: "RUN", reason: "The configured fit threshold was met." };
}
