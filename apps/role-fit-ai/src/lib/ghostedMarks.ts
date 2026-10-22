import type { Application } from "../hooks/useApplications.ts";
import type { ApplicationMutation } from "./applicationMutation.ts";
import { displayCompany } from "./applicationFacts.ts";
import { stageHistoryFits, withStageChange } from "./applicationStageHistory.ts";
import { noResponseCandidate, noResponseCandidates } from "./noResponse.ts";

export type GhostedMark = { id: string; at: string };

export type GhostedMarksPlan =
  | { kind: "history-full"; application: Application }
  | { kind: "ready"; next: Application[]; mutations: ApplicationMutation[] };

const MARKABLE_STATUSES = new Set(["applied", "interviewing"]);

// Each still-Applied/Interviewing record moves to Ghosted with one stage entry
// dated as given (the first mark of an id wins) and a new revision; anything
// else is skipped. A full timeline refuses the whole batch, never part of it.
export function planGhostedMarks(
  current: Application[],
  marks: GhostedMark[],
  nextRevision: (previous: string) => string
): GhostedMarksPlan {
  const atById = new Map<string, string>();
  for (const mark of marks) if (!atById.has(mark.id)) atById.set(mark.id, mark.at);
  const targets = current.filter(
    (application) => atById.has(application.id) && MARKABLE_STATUSES.has(application.status)
  );
  const full = targets.find((application) => !stageHistoryFits(application, "ghosted"));
  if (full) return { kind: "history-full", application: full };
  const marked = new Map(targets.map((application): [string, Application] => [application.id, {
    ...application,
    status: "ghosted",
    stageHistory: withStageChange(application, "ghosted", application.stageHistory, atById.get(application.id)),
    updatedAt: nextRevision(application.updatedAt)
  }]));
  return {
    kind: "ready",
    next: current.map((application) => marked.get(application.id) ?? application),
    mutations: targets.map((application) => ({
      id: application.id,
      operation: "upsert",
      baseUpdatedAt: application.updatedAt
    }))
  };
}

// Records an automatic pass may still try: flagged, not yet tried this
// session, and with room for the stage entry (a full timeline stays flagged
// for a manual mark, which explains the limit, instead of failing quietly).
export function autoGhostingCandidateIds(
  applications: Application[],
  afterDays: number,
  attempted: ReadonlySet<string>,
  today = new Date()
): string[] {
  return noResponseCandidates(applications, afterDays, today)
    .map((candidate) => candidate.application)
    .filter((application) => !attempted.has(application.id) && stageHistoryFits(application, "ghosted"))
    .map((application) => application.id);
}

// Names the record, since every row of a bulk mark starts selected.
export function ghostedTimelineFullMessage(application: Application): string {
  return `${displayCompany(application)}'s timeline is full. Remove one of its timeline entries or leave it unselected, then try again.`;
}

export type AutoGhostingPass = {
  ids: string[];
  afterDays: number;
  attempted: Set<string>;
  // Rechecked under the lock before re-reading: the user turned automation
  // off, changed the threshold, has a write in flight, or sees a tracker error.
  isCurrent: () => boolean;
  refresh: () => Promise<boolean>;
  getApplication: (id: string) => Application | undefined;
  // The record open in Application Detail right now, checked after the re-read.
  isOpen?: (id: string) => boolean;
  markGhosted: (marks: GhostedMark[]) => Promise<number | null>;
  today?: () => Date;
};

// One automatic pass: re-read the tracker, re-derive each candidate from the
// fresh record (another tab may have logged activity or marked it), and mark
// the rest in one write dated the day each threshold passed. Every id sent is
// remembered, so a failed or conflicting write is never retried this session.
// Returns how many records the pass marked.
export async function runAutoGhostingPass(pass: AutoGhostingPass): Promise<number> {
  if (!pass.isCurrent() || !(await pass.refresh()) || !pass.isCurrent()) return 0;
  const today = pass.today?.() ?? new Date();
  const marks = pass.ids.flatMap((id): GhostedMark[] => {
    const application = pass.getApplication(id);
    if (!application || pass.attempted.has(id) || pass.isOpen?.(id) || !stageHistoryFits(application, "ghosted")) return [];
    const candidate = noResponseCandidate(application, pass.afterDays, today);
    return candidate ? [{ id, at: candidate.dueAt }] : [];
  });
  if (!marks.length) return 0;
  for (const mark of marks) pass.attempted.add(mark.id);
  return (await pass.markGhosted(marks)) ?? 0;
}
