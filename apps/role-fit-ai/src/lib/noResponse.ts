import type { Application } from "../hooks/useApplications.ts";
import { toIso } from "./dateInput.ts";
import { parseDate } from "./applicationFacts.ts";

// "No response" is derived, never stored: an Applied or Interviewing record
// whose latest activity (the submission or any timeline entry, a follow-up the
// user sent included) is at least `afterDays` local days old. A future-dated
// entry (a scheduled interview) or a follow-up planned for today or later keeps
// the record fresh: the user's own plan outranks the silence. Marking one
// Ghosted is a separate, stored stage change.

const NO_RESPONSE_STATUSES = new Set(["applied", "interviewing"]);
const DAY_MS = 86_400_000;

type ActivityFacts = Pick<Application, "status" | "appliedAt" | "stageHistory">;

export type NoResponseCandidate = {
  application: Application;
  lastActivityAt: string;
  silentDays: number;
  // The local day the threshold passed, stored as that day's noon (day-granular
  // like every tracker date). An automatic mark records this, not the day the
  // app happened to be opened.
  dueAt: string;
};

const localMidnight = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const dayInput = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function lastActivityAt(application: ActivityFacts): string | null {
  let latest: Date | null = null;
  let latestIso: string | null = null;
  for (const at of [application.appliedAt, ...(application.stageHistory ?? []).map((entry) => entry.at)]) {
    const date = parseDate(at);
    if (date && (!latest || date > latest)) {
      latest = date;
      latestIso = at ?? null;
    }
  }
  return latestIso;
}

export function noResponseCandidate(
  application: Application,
  afterDays: number,
  today = new Date()
): NoResponseCandidate | null {
  if (!NO_RESPONSE_STATUSES.has(application.status) || !application.appliedAt) return null;
  const followup = parseDate(application.followupAt);
  if (followup && localMidnight(followup) >= localMidnight(today)) return null;
  const last = lastActivityAt(application);
  const lastDate = parseDate(last ?? undefined);
  if (!last || !lastDate) return null;
  const start = localMidnight(lastDate);
  const silentDays = Math.round((localMidnight(today).getTime() - start.getTime()) / DAY_MS);
  if (silentDays < afterDays) return null;
  const due = new Date(start.getFullYear(), start.getMonth(), start.getDate() + afterDays);
  return { application, lastActivityAt: last, silentDays, dueAt: toIso(dayInput(due)) };
}

// Longest silence first.
export function noResponseCandidates(
  applications: Application[],
  afterDays: number,
  today = new Date()
): NoResponseCandidate[] {
  return applications
    .map((application) => noResponseCandidate(application, afterDays, today))
    .filter((candidate): candidate is NoResponseCandidate => candidate !== null)
    .sort((left, right) => right.silentDays - left.silentDays);
}
