import type { Application, ApplicationStatus } from "../hooks/useApplications.ts";
import {
  INTERVIEW_KIND_LABEL,
  STAGE_HISTORY_MAX_ENTRIES,
  type StageHistoryEntry
} from "../../shared/applicationStageHistoryContract.ts";
import { todayIso } from "./dateInput.ts";

type HistoryFacts = Pick<Application, "status" | "appliedAt" | "stageHistory">;

export function newStageEntryId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// History starts at submission: a stage change on a record with an application
// date appends one stage entry (the server refuses the save without it). The
// submission itself, from Draft or a job-only Skip, is its `appliedAt`.
export function withStageChange(
  saved: HistoryFacts,
  nextStatus: ApplicationStatus,
  stageHistory: StageHistoryEntry[] | undefined,
  at = todayIso()
): StageHistoryEntry[] | undefined {
  if (!saved.appliedAt || saved.status === nextStatus || nextStatus === "draft") return stageHistory;
  return [...(stageHistory ?? []), { id: newStageEntryId(), type: "stage", status: nextStatus, at }];
}

type SavedHistory = { status: ApplicationStatus; stageHistory: StageHistoryEntry[] | undefined };

// Each entry is saved on its own, against the saved record: replaced in place
// or appended. Saving a new interview on an Applied record also moves it to
// Interviewing and records that move, so an unsaved Log changes nothing.
export function withEntrySaved(saved: HistoryFacts, entry: StageHistoryEntry): SavedHistory {
  const history = saved.stageHistory ?? [];
  const exists = history.some((current) => current.id === entry.id);
  const stageHistory = exists
    ? history.map((current) => (current.id === entry.id ? entry : current))
    : [...history, entry];
  const status = !exists && entry.type === "interview" && saved.status === "applied" ? "interviewing" : saved.status;
  return { status, stageHistory: withStageChange(saved, status, stageHistory) };
}

export function withEntryRemoved(saved: HistoryFacts, id: string): SavedHistory {
  const stageHistory = (saved.stageHistory ?? []).filter((entry) => entry.id !== id);
  return { status: saved.status, stageHistory: stageHistory.length ? stageHistory : undefined };
}

// Duplicate merge keeps the canonical record's history plus every other
// member's entries (first copy of an id wins). Returns null when the union
// would exceed the stored limit, so the caller refuses rather than drops.
export function mergeStageHistories(
  canonical: StageHistoryEntry[] | undefined,
  others: (StageHistoryEntry[] | undefined)[]
): StageHistoryEntry[] | undefined | null {
  const seen = new Set<string>();
  const merged = [canonical, ...others].flatMap((history) => history ?? []).filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
  if (merged.length > STAGE_HISTORY_MAX_ENTRIES) return null;
  return merged.length ? merged : undefined;
}

export type TimelineRow =
  | { key: string; kind: "applied" | "skipped"; at: string }
  | { key: string; kind: "stage"; at: string; entry: Extract<StageHistoryEntry, { type: "stage" }> }
  | { key: string; kind: "interview"; at: string; entry: Extract<StageHistoryEntry, { type: "interview" }>; round: number; scheduled: boolean }
  | { key: string; kind: "response" | "followup"; at: string; entry: Extract<StageHistoryEntry, { type: "response" | "followup" }> };

const localDay = (date: Date) => date.getFullYear() * 10_000 + (date.getMonth() + 1) * 100 + date.getDate();

// Oldest first. Anchors come from the dated fields history does not repeat; a
// Skipped anchor appears only for records saved before history recorded it.
// Rounds number interviews by date; a future-dated interview is scheduled.
export function deriveTimeline(
  application: Pick<Application, "status" | "appliedAt" | "notApplyingAt" | "stageHistory">,
  today = new Date()
): TimelineRow[] {
  const entries = application.stageHistory ?? [];
  const anchors: TimelineRow[] = [];
  if (application.appliedAt) anchors.push({ key: "applied", kind: "applied", at: application.appliedAt });
  if (
    application.status === "not_applying"
    && application.notApplyingAt
    && !entries.some((entry) => entry.type === "stage" && entry.status === "not_applying")
  ) {
    anchors.push({ key: "skipped", kind: "skipped", at: application.notApplyingAt });
  }

  const byDate = (left: { at: string; order: number }, right: { at: string; order: number }) =>
    Date.parse(left.at) - Date.parse(right.at) || left.order - right.order;
  const interviewRounds = new Map(
    entries
      .map((entry, order) => ({ entry, at: entry.at, order }))
      .filter(({ entry }) => entry.type === "interview")
      .sort(byDate)
      .map(({ entry }, index) => [entry.id, index + 1])
  );
  const todayKey = localDay(today);

  const rows = entries.map((entry): TimelineRow => {
    const key = `entry-${entry.id}`;
    switch (entry.type) {
      case "stage":
        return { key, kind: "stage", at: entry.at, entry };
      case "interview":
        return {
          key,
          kind: "interview",
          at: entry.at,
          entry,
          round: interviewRounds.get(entry.id) ?? 0,
          scheduled: localDay(new Date(entry.at)) > todayKey
        };
      default:
        return { key, kind: entry.type, at: entry.at, entry };
    }
  });

  return [...anchors, ...rows]
    .map((row, order) => ({ row, at: row.at, order }))
    .sort(byDate)
    .map(({ row }) => row);
}

type InterviewRow = Extract<TimelineRow, { kind: "interview" }>;

export function interviewLabel(row: InterviewRow): string {
  return `Round ${row.round} · ${INTERVIEW_KIND_LABEL[row.entry.kind]}`;
}

// The most recent interview that has happened and the soonest one scheduled.
export function interviewMilestones(
  application: Pick<Application, "status" | "appliedAt" | "notApplyingAt" | "stageHistory">,
  today = new Date()
): { latest?: InterviewRow; next?: InterviewRow } {
  const interviews = deriveTimeline(application, today).filter((row): row is InterviewRow => row.kind === "interview");
  const held = interviews.filter((row) => !row.scheduled);
  return {
    latest: held[held.length - 1],
    next: interviews.find((row) => row.scheduled)
  };
}
