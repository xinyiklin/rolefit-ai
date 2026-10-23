export const APPLICATION_STATUSES = [
  "draft",
  "not_applying",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "ghosted",
  "withdrawn"
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

const STATUS_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  draft: ["draft", "applied", "not_applying"],
  not_applying: ["not_applying"],
  applied: ["applied", "interviewing", "offer", "rejected", "ghosted", "withdrawn"],
  interviewing: ["interviewing", "offer", "rejected", "ghosted", "withdrawn"],
  offer: ["offer", "rejected", "withdrawn"],
  rejected: ["rejected"],
  // A late reply reopens a Ghosted record; Applied undoes a premature mark.
  ghosted: ["ghosted", "applied", "interviewing", "offer", "rejected", "withdrawn"],
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

// A move the tracker's row stage menu offers. Ghosted means silence after
// applying, so only a record that can be waiting on a reply (or is already
// Ghosted) may move there. The server's status route uses the same rule.
export function stageMenuMoveAllowed(current: ApplicationStatus, next: ApplicationStatus): boolean {
  return current !== next
    && applicationStatusTransitionAllowed(current, next)
    && (next !== "ghosted" || STATUS_TRANSITIONS[current].includes(next));
}
