// Canonical order for storage and display. The server imports this list, so it
// must stay dependency-free. `constraints` is the retired catch-all: still valid
// on saved records, never offered for a new decision.
export const NOT_APPLYING_REASONS = [
  "work_authorization",
  "clearance",
  "graduation",
  "location",
  "compensation",
  "schedule",
  "fit",
  "level",
  "already_applied",
  "posting_closed",
  "interest",
  "other",
  "constraints"
] as const;

export type NotApplyingReason = (typeof NOT_APPLYING_REASONS)[number];

export const LEGACY_NOT_APPLYING_REASONS: readonly NotApplyingReason[] = ["constraints"];

export const NOT_APPLYING_REASON_GROUPS: { label: string; reasons: NotApplyingReason[] }[] = [
  { label: "Eligibility", reasons: ["work_authorization", "clearance", "graduation"] },
  { label: "Logistics", reasons: ["location", "compensation", "schedule"] },
  { label: "Fit", reasons: ["fit", "level"] },
  { label: "Status", reasons: ["already_applied", "posting_closed"] },
  { label: "Personal", reasons: ["interest", "other"] }
];

export const NOT_APPLYING_REASON_LABEL: Record<NotApplyingReason, string> = {
  work_authorization: "Work authorization or sponsorship",
  clearance: "Security clearance or citizenship",
  graduation: "Graduation timing or degree requirement",
  location: "Location, on-site, or relocation",
  compensation: "Compensation",
  schedule: "Schedule, travel, or job type",
  fit: "Not a fit",
  level: "Level mismatch (too senior or too junior)",
  already_applied: "Already applied or duplicate posting",
  posting_closed: "Posting closed or expired",
  interest: "Not interested",
  other: "Other",
  constraints: "Pay, location, authorization, or other constraint"
};

export const NOT_APPLYING_REASON_SHORT_LABEL: Record<NotApplyingReason, string> = {
  work_authorization: "Work authorization",
  clearance: "Clearance",
  graduation: "Graduation timing",
  location: "Location",
  compensation: "Compensation",
  schedule: "Schedule",
  fit: "Not a fit",
  level: "Level",
  already_applied: "Already applied",
  posting_closed: "Posting closed",
  interest: "Not interested",
  other: "Other",
  constraints: "Constraint"
};

function isNotApplyingReason(value: unknown): value is NotApplyingReason {
  return typeof value === "string" && (NOT_APPLYING_REASONS as readonly string[]).includes(value);
}

// Known values only, without duplicates, in canonical order.
export function normalizeNotApplyingReasons(value: unknown): NotApplyingReason[] {
  if (!Array.isArray(value)) return [];
  const present = new Set(value.filter(isNotApplyingReason));
  return NOT_APPLYING_REASONS.filter((reason) => present.has(reason));
}

// Narrow one-line surfaces pass a limit; the rest are summarized as "+N".
export function formatNotApplyingReasons(
  reasons: readonly NotApplyingReason[] | undefined,
  limit?: number
): string {
  const labels = normalizeNotApplyingReasons(reasons).map((reason) => NOT_APPLYING_REASON_SHORT_LABEL[reason]);
  if (limit === undefined || labels.length <= limit) return labels.join(", ");
  return `${labels.slice(0, limit).join(", ")} +${labels.length - limit}`;
}
