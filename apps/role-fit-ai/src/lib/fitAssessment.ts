// Display layer for the shared fit vocabulary: the contract in
// shared/fitAssessmentContract.ts stays React- and copy-free so the server and
// evals can import it; every user-facing word for that vocabulary lives here.

import type {
  ApplicationRecommendation,
  AssessmentConfidence,
  EligibilityStatus,
  FitAuditStatus,
  FitVerdict,
  SubmissionReadiness
} from "../../shared/fitAssessmentContract.ts";

export const FIT_VERDICT_LABEL: Record<FitVerdict, string> = {
  STRONG_FIT: "Strong fit",
  REASONABLE_FIT: "Reasonable fit",
  STRETCH: "Stretch",
  LIMITED_FIT: "Limited fit"
};

// Tone keys stay on the existing .application-fit--* / fit color classes so the
// vocabulary change does not also become a color change.
export const FIT_VERDICT_TONE: Record<
  FitVerdict,
  "strong" | "good" | "stretch" | "weak"
> = {
  STRONG_FIT: "strong",
  REASONABLE_FIT: "good",
  STRETCH: "stretch",
  LIMITED_FIT: "weak"
};

export const CONFIDENCE_LABEL: Record<AssessmentConfidence, string> = {
  HIGH: "High confidence",
  MEDIUM: "Medium confidence",
  LOW: "Low confidence"
};

export const ELIGIBILITY_LABEL: Record<EligibilityStatus, string> = {
  SATISFIED: "Eligibility satisfied",
  UNCERTAIN: "Eligibility uncertain",
  NOT_SATISFIED: "Eligibility not satisfied"
};

export const RECOMMENDATION_LABEL: Record<ApplicationRecommendation, string> = {
  APPLY: "Apply",
  TAILOR_FIRST: "Polish first",
  CONFIRM_ELIGIBILITY: "Confirm eligibility",
  APPLY_SELECTIVELY: "Apply selectively",
  NOT_RECOMMENDED: "Not recommended"
};

export const SUBMISSION_READINESS_LABEL: Record<SubmissionReadiness, string> = {
  READY: "Ready",
  REVISIONS_RECOMMENDED: "Revisions recommended",
  EVIDENCE_NEEDED: "Evidence needed",
  NOT_READY: "Not ready"
};

export const FIT_AUDIT_STATUS_LABEL: Record<FitAuditStatus, string> = {
  WAITING_FOR_JOB: "Waiting for a prepared job",
  WAITING_FOR_RESUME: "Waiting for a resume",
  ASSESSING: "Assessing initial fit…",
  NEEDS_INFORMATION: "More information needed",
  READY: "Assessed",
  STALE: "Assessment out of date",
  FAILED: "Initial fit audit failed"
};

// STRONG_FIT -> "verdict-pill--strong-fit", matching the classes the review
// surfaces already ship. LIMITED_FIT resolves to "verdict-pill--limited-fit",
// which has no rule yet — it lands with the UI change that first renders it.
export function fitVerdictPillClass(verdict: FitVerdict): string {
  return `verdict-pill--${verdict.replace(/_/g, "-").toLowerCase()}`;
}
