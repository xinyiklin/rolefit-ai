export type NotApplyingReason = "fit" | "interest" | "constraints" | "other";

export const NOT_APPLYING_REASON_LABEL: Record<NotApplyingReason, string> = {
  fit: "Not a fit",
  interest: "Not interested",
  constraints: "Pay, location, authorization, or other constraint",
  other: "Other"
};
