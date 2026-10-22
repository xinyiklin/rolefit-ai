import type { Application } from "../hooks/useApplications";
import { displayCompany, parseDate } from "./applicationDisplay.ts";
import { deriveTimeline, interviewLabel } from "./applicationStageHistory.ts";
import { lastActivityAt, noResponseCandidate } from "./noResponse.ts";

// Every metric derives from stored fields only. Only an explicit `appliedAt` is
// a submission event: createdAt is a tracking event and updatedAt can mean any
// edit, so neither stands in for an employer interaction. A date in the future
// is not a submission yet. Period-scoped metrics are a cohort view: the
// applications sent in the period, judged by where they stand today.

const DAY_MS = 86_400_000;
// Windowed periods are whole calendar weeks (Monday first, the current week
// included) so the register's week rows sum exactly to its totals line. All
// time is kept by month.
export const ANALYTICS_PERIODS = [
  { id: "8w", label: "8 weeks", weeks: 8 },
  { id: "12w", label: "12 weeks", weeks: 12 },
  { id: "26w", label: "26 weeks", weeks: 26 },
  { id: "all", label: "All time", weeks: null }
] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number]["id"];

// A rate over fewer than this many applications is not shown.
export const MIN_RATE_SAMPLE = 3;
const UPCOMING_FOLLOWUP_DAYS = 7;
const OPEN_STATUSES = ["applied", "interviewing", "offer"];
const CLOSED_STATUSES = ["rejected", "withdrawn", "ghosted"];

// Local calendar day as an integer, so day arithmetic survives DST.
export const dayNumber = (date: Date) =>
  Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
export const dayToDate = (day: number) => {
  const utc = new Date(day * DAY_MS);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
};

export function isSubmittedApplication(application: Application) {
  // A later decision to skip does not erase a prior employer submission.
  return application.status !== "draft" && Boolean(parseDate(application.appliedAt));
}

function sentDay(application: Application, todayDay: number): number | null {
  if (!isSubmittedApplication(application)) return null;
  const day = dayNumber(parseDate(application.appliedAt) as Date);
  return day <= todayDay ? day : null;
}

// Monday of the week holding `day`.
const weekStartDay = (day: number) => day - ((dayToDate(day).getDay() + 6) % 7);

function periodWeeks(period: AnalyticsPeriod): number | null {
  return ANALYTICS_PERIODS.find((option) => option.id === period)?.weeks ?? null;
}

function periodStartDay(period: AnalyticsPeriod, todayDay: number): number | null {
  const weeks = periodWeeks(period);
  return weeks === null ? null : weekStartDay(todayDay) - (weeks - 1) * 7;
}

// The same elapsed span one period earlier (Monday through this weekday), so
// a part-week today compares with a part-week then. All time has none.
export function previousApplications(applications: Application[], period: AnalyticsPeriod, today = new Date()) {
  const todayDay = dayNumber(today);
  const start = periodStartDay(period, todayDay);
  const weeks = periodWeeks(period);
  if (start === null || weeks === null) return null;
  const shift = weeks * 7;
  return applications.filter((application) => {
    const day = sentDay(application, todayDay);
    return day !== null && day >= start - shift && day <= todayDay - shift;
  });
}

// The stages a submitted application can stand at, in reading order; a later
// skip of a sent application stays in the cohort as Skipped.
export const COHORT_STAGES = ["applied", "interviewing", "offer", "ghosted", "rejected", "withdrawn", "not_applying"] as const;
export type CohortStage = (typeof COHORT_STAGES)[number];

export function cohortStageCounts(cohort: Application[]): Record<CohortStage, number> {
  const counts = Object.fromEntries(COHORT_STAGES.map((stage) => [stage, 0])) as Record<CohortStage, number>;
  for (const application of cohort) {
    if ((COHORT_STAGES as readonly string[]).includes(application.status)) counts[application.status as CohortStage] += 1;
  }
  return counts;
}

// A count against the same count in the previous window: no change worth a
// figure when both are zero, "new" when only the earlier one is.
export type PeriodChange = { kind: "none" } | { kind: "new" } | { kind: "percent"; percent: number };

export function periodChange(current: number, previous: number): PeriodChange {
  if (!previous) return current ? { kind: "new" } : { kind: "none" };
  return { kind: "percent", percent: Math.round(((current - previous) / previous) * 100) };
}

// The cohort: applications sent inside the period.
export function sentApplications(applications: Application[], period: AnalyticsPeriod, today = new Date()) {
  const todayDay = dayNumber(today);
  const start = periodStartDay(period, todayDay);
  return applications.filter((application) => {
    const day = sentDay(application, todayDay);
    return day !== null && (start === null || day >= start);
  });
}

export type Reach = { responded: boolean; interviewed: boolean; offer: boolean; responseDays: number | null };

// How far a submitted application got. A bare stage move to Rejected or
// Withdrawn says neither when nor whether the employer replied, so those count
// as responded only through a response or interview entry. Offer implies
// Interviewing implies Responded, so the funnel steps always nest.
export function applicationReach(application: Application, today = new Date()): Reach {
  const history = application.stageHistory ?? [];
  const offer = application.status === "offer"
    || history.some((entry) => entry.type === "stage" && entry.status === "offer");
  const interviewed = offer || application.status === "interviewing"
    || history.some((entry) => entry.type === "interview" || (entry.type === "stage" && entry.status === "interviewing"));
  const responded = interviewed || history.some((entry) => entry.type === "response");

  // Time to first response needs a dated response or interview that has
  // happened; a stage move is not a reply date and a scheduled interview has
  // not occurred yet.
  const todayDay = dayNumber(today);
  const sent = sentDay(application, todayDay);
  const replyDays = history
    .filter((entry) => entry.type === "response" || entry.type === "interview")
    .map((entry) => parseDate(entry.at))
    .filter((date): date is Date => date !== null)
    .map(dayNumber)
    .filter((day) => sent !== null && day >= sent && day <= todayDay);
  return {
    responded,
    interviewed,
    offer,
    responseDays: replyDays.length && sent !== null ? Math.min(...replyDays) - sent : null
  };
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}


export type PeriodMetrics = {
  sent: number;
  responded: number;
  interviewed: number;
  offers: number;
  // Null under MIN_RATE_SAMPLE sent, as on every register row.
  responseRate: number | null;
  medianResponseDays: number | null;
};

export function periodMetrics(applications: Application[], period: AnalyticsPeriod, today = new Date()): PeriodMetrics {
  const cohort = sentApplications(applications, period, today);
  const reaches = cohort.map((application) => applicationReach(application, today));
  const responded = reaches.filter((reach) => reach.responded).length;
  const interviewed = reaches.filter((reach) => reach.interviewed).length;
  const timed = reaches.flatMap((reach) => (reach.responseDays === null ? [] : [reach.responseDays]));
  return {
    sent: cohort.length,
    responded,
    interviewed,
    offers: reaches.filter((reach) => reach.offer).length,
    responseRate: cohort.length >= MIN_RATE_SAMPLE ? responded / cohort.length : null,
    medianResponseDays: median(timed)
  };
}

export type OutcomeId = "awaiting" | "noResponse" | "interviewing" | "offer" | "rejected" | "ghosted" | "withdrawn" | "skipped";
export const OUTCOME_LABEL: Record<OutcomeId, string> = {
  awaiting: "Awaiting response",
  noResponse: "No response",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  ghosted: "Ghosted",
  withdrawn: "Withdrawn",
  skipped: "Skipped"
};

// Where a submitted application stands now. Mutually exclusive: an Applied or
// Interviewing record silent past the threshold is No response, not Awaiting
// or Interviewing.
export function outcomeOf(application: Application, ghostedAfterDays: number, today = new Date()): OutcomeId {
  if (noResponseCandidate(application, ghostedAfterDays, today)) return "noResponse";
  switch (application.status) {
    case "applied": return "awaiting";
    case "not_applying": return "skipped";
    case "interviewing":
    case "offer":
    case "rejected":
    case "ghosted":
    case "withdrawn":
      return application.status;
    default:
      return "awaiting";
  }
}

export function outcomeBreakdown(cohort: Application[], ghostedAfterDays: number, today = new Date()) {
  const counts: Record<OutcomeId, number> = {
    awaiting: 0, noResponse: 0, interviewing: 0, offer: 0, rejected: 0, ghosted: 0, withdrawn: 0, skipped: 0
  };
  for (const application of cohort) counts[outcomeOf(application, ghostedAfterDays, today)] += 1;
  return (Object.keys(OUTCOME_LABEL) as OutcomeId[])
    .filter((id) => id !== "skipped" || counts.skipped > 0)
    .map((id) => ({ id, label: OUTCOME_LABEL[id], count: counts[id] }));
}

export type RegisterEntry = {
  application: Application;
  sentAt: Date;
  outcome: OutcomeId;
  reach: Reach;
};

export type RegisterRow = {
  key: string;
  unit: "week" | "month";
  from: Date;
  to: Date;
  // Oldest first, so a row's tally reads left to right in sending order.
  entries: RegisterEntry[];
  sent: number;
  responded: number;
  interviewed: number;
  offers: number;
  responseRate: number | null;
  medianResponseDays: number | null;
};

function registerRow(key: string, unit: RegisterRow["unit"], from: number, to: number, entries: RegisterEntry[]): RegisterRow {
  const inside = entries
    .filter((entry) => {
      const day = dayNumber(entry.sentAt);
      return day >= from && day <= to;
    })
    .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  const responded = inside.filter((entry) => entry.reach.responded).length;
  return {
    key,
    unit,
    from: dayToDate(from),
    to: dayToDate(to),
    entries: inside,
    sent: inside.length,
    responded,
    interviewed: inside.filter((entry) => entry.reach.interviewed).length,
    offers: inside.filter((entry) => entry.reach.offer).length,
    responseRate: inside.length >= MIN_RATE_SAMPLE ? responded / inside.length : null,
    medianResponseDays: median(inside.flatMap((entry) => (entry.reach.responseDays === null ? [] : [entry.reach.responseDays])))
  };
}

// The register, newest first: one row per calendar week of the period
// (empty weeks included, so quiet stretches stay visible), or one per month
// from the first send for All time.
// One row per calendar week of the period (empty weeks included), or per
// month: from the period's first month, or from the first send for All time.
export function registerRows(
  applications: Application[],
  period: AnalyticsPeriod,
  ghostedAfterDays: number,
  today = new Date(),
  unit: "week" | "month" = periodWeeks(period) === null ? "month" : "week"
): RegisterRow[] {
  const todayDay = dayNumber(today);
  const entries = sentApplications(applications, period, today).map((application): RegisterEntry => ({
    application,
    sentAt: parseDate(application.appliedAt) as Date,
    outcome: outcomeOf(application, ghostedAfterDays, today),
    reach: applicationReach(application, today)
  }));

  const weeks = periodWeeks(period);
  if (weeks !== null && unit === "week") {
    const current = weekStartDay(todayDay);
    return Array.from({ length: weeks }, (_, index) => {
      const from = current - index * 7;
      return registerRow(`w${from}`, "week", from, Math.min(from + 6, todayDay), entries);
    });
  }

  const periodStart = periodStartDay(period, todayDay);
  if (periodStart === null && !entries.length) return [];
  const first = dayToDate(periodStart ?? Math.min(...entries.map((entry) => dayNumber(entry.sentAt))));
  const months = (today.getFullYear() - first.getFullYear()) * 12 + today.getMonth() - first.getMonth() + 1;
  return Array.from({ length: months }, (_, index) => {
    const start = new Date(today.getFullYear(), today.getMonth() - index, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    return registerRow(
      `m${start.getFullYear()}-${start.getMonth()}`,
      "month",
      Math.max(dayNumber(start), periodStart ?? -Infinity),
      Math.min(dayNumber(end), todayDay),
      entries
    );
  });
}

// How long open records have gone without any activity, for the "Time without
// a response" bars. The threshold is always a bin edge, so the bins it marks
// past hold exactly the No response candidates; a record held by a planned
// follow-up is left out, as it is from No response.
export const SILENCE_EDGES = [0, 8, 15, 31, 60] as const;
const SILENCE_STATUSES = ["applied", "interviewing"];

export type SilenceBin = { id: string; label: string; min: number; count: number; past: boolean };

export function silenceBins(applications: Application[], ghostedAfterDays: number, today = new Date()) {
  const todayDay = dayNumber(today);
  const edges = [...new Set([...SILENCE_EDGES, ghostedAfterDays])].sort((a, b) => a - b);
  const bins: SilenceBin[] = edges.map((min, index) => {
    const next = edges[index + 1];
    return {
      id: `d${min}`,
      label: next === undefined ? `${min}+ days` : next - 1 === min ? `${min} days` : `${min}–${next - 1} days`,
      min,
      count: 0,
      past: min >= ghostedAfterDays
    };
  });
  let open = 0;
  for (const application of applications) {
    // The same eligibility as noResponseCandidate: an open stage with a date.
    if (!SILENCE_STATUSES.includes(application.status) || !application.appliedAt) continue;
    const followup = parseDate(application.followupAt);
    if (followup && dayNumber(followup) >= todayDay) continue;
    const last = parseDate(lastActivityAt(application) ?? undefined);
    if (!last) continue;
    const silent = todayDay - dayNumber(last);
    if (silent < 0) continue;
    open += 1;
    [...bins].reverse().find((bin) => silent >= bin.min)!.count += 1;
  }
  return { bins, open };
}

export type UpcomingItem = {
  // Unique per item: an application can have two interviews on one day.
  key: string;
  application: Application;
  kind: "interview" | "followup";
  at: string;
  // Local days from today; negative is overdue.
  days: number;
  // The round and kind of a scheduled interview.
  detail?: string;
};

// Scheduled interviews (today onward) and follow-ups due within a week or
// overdue, for open records only.
export function upcomingItems(applications: Application[], today = new Date()) {
  const todayDay = dayNumber(today);
  const interviews: UpcomingItem[] = [];
  const followups: UpcomingItem[] = [];
  for (const application of applications) {
    if (!OPEN_STATUSES.includes(application.status)) continue;
    for (const row of deriveTimeline(application, today)) {
      if (row.kind !== "interview") continue;
      const date = parseDate(row.at);
      if (date && dayNumber(date) >= todayDay) {
        interviews.push({ key: `${application.id}-${row.key}`, application, kind: "interview", at: row.at, days: dayNumber(date) - todayDay, detail: interviewLabel(row) });
      }
    }
    const due = parseDate(application.followupAt);
    if (due && dayNumber(due) - todayDay <= UPCOMING_FOLLOWUP_DAYS) {
      followups.push({ key: `${application.id}-followup`, application, kind: "followup", at: application.followupAt as string, days: dayNumber(due) - todayDay });
    }
  }
  const order = (a: UpcomingItem, b: UpcomingItem) =>
    a.days - b.days || displayCompany(a.application).localeCompare(displayCompany(b.application));
  return { interviews: interviews.sort(order), followups: followups.sort(order) };
}

export function trackingHygiene(applications: Application[]) {
  let missingFollowup = 0;
  let closed = 0;
  let submitted = 0;

  for (const application of applications) {
    if (!application.followupAt && !["draft", "not_applying", ...CLOSED_STATUSES].includes(application.status)) {
      missingFollowup += 1;
    }
    if (CLOSED_STATUSES.includes(application.status)) closed += 1;
    if (isSubmittedApplication(application)) submitted += 1;
  }

  return { missingFollowup, closed, submitted };
}
