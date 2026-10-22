import type { ApplicationStatus } from "../src/lib/applicationStatusTransitions.ts";

// What happened to a submitted application after it was sent. The submission
// itself stays in `appliedAt`; history holds only facts stored nowhere else.
export const INTERVIEW_KINDS = [
  "recruiter_screen",
  "hiring_manager",
  "technical",
  "assessment",
  "panel_onsite",
  "final",
  "other"
] as const;

export type InterviewKind = (typeof INTERVIEW_KINDS)[number];

export const INTERVIEW_KIND_LABEL: Record<InterviewKind, string> = {
  recruiter_screen: "Recruiter screen",
  hiring_manager: "Hiring manager",
  technical: "Technical",
  assessment: "Assessment",
  panel_onsite: "Panel / onsite",
  final: "Final",
  other: "Other"
};

export const STAGE_HISTORY_MAX_ENTRIES = 60;
export const STAGE_HISTORY_NOTE_MAX_LENGTH = 500;

const STAGE_ENTRY_STATUSES = ["not_applying", "applied", "interviewing", "offer", "rejected", "ghosted", "withdrawn"] as const;

export type StageHistoryEntry =
  | { id: string; type: "stage"; status: Exclude<ApplicationStatus, "draft">; at: string }
  | { id: string; type: "interview"; kind: InterviewKind; at: string; note?: string }
  | { id: string; type: "response"; at: string; note?: string }
  | { id: string; type: "followup"; at: string; note?: string };

const ENTRY_ID = /^[a-z0-9_-]{1,40}$/;
const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const inList = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);
const timestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const note = (value: unknown) =>
  value === undefined
  || (typeof value === "string" && Boolean(value.trim()) && value.length <= STAGE_HISTORY_NOTE_MAX_LENGTH);

function validEntry(raw: unknown): raw is StageHistoryEntry {
  if (!isObject(raw) || typeof raw.id !== "string" || !ENTRY_ID.test(raw.id) || !timestamp(raw.at)) return false;
  switch (raw.type) {
    case "stage":
      return exactKeys(raw, ["id", "type", "status", "at"]) && inList(STAGE_ENTRY_STATUSES, raw.status);
    case "interview":
      return exactKeys(raw, ["id", "type", "kind", "at", "note"]) && inList(INTERVIEW_KINDS, raw.kind) && note(raw.note);
    case "response":
    case "followup":
      return exactKeys(raw, ["id", "type", "at", "note"]) && note(raw.note);
    default:
      return false;
  }
}

// Absent → undefined; an empty list is written as absent. Any invalid entry,
// a duplicate id, or an over-limit list returns null so the caller refuses the
// whole record instead of silently dropping history.
export function parseStageHistory(raw: unknown): StageHistoryEntry[] | undefined | null {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > STAGE_HISTORY_MAX_ENTRIES || !raw.every(validEntry)) return null;
  if (new Set(raw.map((entry) => entry.id)).size !== raw.length) return null;
  return raw.length ? raw.map((entry) => ({ ...entry })) : undefined;
}
