export const APPLICATION_STATUSES = [
  "draft",
  "not_applying",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn"
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

const STATUS_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  draft: ["draft", "applied", "not_applying"],
  not_applying: ["not_applying"],
  applied: ["applied", "interviewing", "offer", "rejected", "withdrawn"],
  interviewing: ["interviewing", "offer", "rejected", "withdrawn"],
  offer: ["offer", "rejected", "withdrawn"],
  rejected: ["rejected"],
  withdrawn: ["withdrawn"]
};

export function applicationStatusOptions(status: ApplicationStatus): readonly ApplicationStatus[] {
  return STATUS_TRANSITIONS[status];
}

export function applicationStatusTransitionAllowed(
  current: ApplicationStatus,
  next: ApplicationStatus
): boolean {
  if (current === "draft") return STATUS_TRANSITIONS.draft.includes(next);
  return next !== "draft" && APPLICATION_STATUSES.includes(current) && APPLICATION_STATUSES.includes(next);
}
