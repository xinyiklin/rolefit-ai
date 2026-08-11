import type { ApplicationStatus } from "../hooks/useApplications.ts";

const STATUS_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
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
  return STATUS_TRANSITIONS[current].includes(next);
}
