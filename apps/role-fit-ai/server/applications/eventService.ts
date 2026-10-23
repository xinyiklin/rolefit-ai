// A timeline entry (interview, employer response, or follow-up sent) logged on
// the server against the latest saved record, through the same transform as
// the tracker's Log buttons: a new interview moves an Applied or Ghosted record
// to Interviewing and records that move.

import {
  INTERVIEW_KINDS,
  STAGE_HISTORY_MAX_ENTRIES,
  STAGE_HISTORY_NOTE_MAX_LENGTH,
  type InterviewKind,
  type StageHistoryEntry
} from "../../shared/applicationStageHistoryContract.ts";
import {
  STAGE_HISTORY_FULL_MESSAGE,
  newStageEntryId,
  withEntrySaved
} from "../../src/lib/applicationStageHistory.ts";
import { exactDayIso, todayIso } from "../../src/lib/dateInput.ts";
import { reconcileApplicationMutations } from "./reconcile.ts";
import { nextApplicationRevision } from "./routeSupport.ts";
import { ApplicationsStorageError, sanitizeApplications } from "./schema.ts";
import {
  readApplicationsSnapshot,
  withApplicationsLock,
  writeApplicationsSnapshot
} from "./storage.ts";

export const APPLICATION_EVENT_TYPES = ["interview", "response", "followup"] as const;
const EVENT_REQUEST_KEYS = ["type", "kind", "date", "note", "baseUpdatedAt"];

const refuse = (message: string) => new ApplicationsStorageError(message, 400);

function eventEntry(request: Record<string, unknown>): StageHistoryEntry {
  const unknownKey = Object.keys(request).find((key) => !EVENT_REQUEST_KEYS.includes(key));
  if (unknownKey) throw refuse(`${unknownKey}: not an event field (send type, kind, date, note, baseUpdatedAt).`);
  const { type, kind, date, note } = request;
  if (!(APPLICATION_EVENT_TYPES as readonly unknown[]).includes(type)) {
    throw refuse(`type: must be one of ${APPLICATION_EVENT_TYPES.join(", ")}.`);
  }
  if (type === "interview" && !(INTERVIEW_KINDS as readonly unknown[]).includes(kind)) {
    throw refuse(`kind: an interview needs one of ${INTERVIEW_KINDS.join(", ")}.`);
  }
  if (type !== "interview" && kind !== undefined) throw refuse("kind: only an interview has a kind; omit it.");
  const at = date === undefined ? todayIso() : typeof date === "string" ? exactDayIso(date) : "";
  if (!at) throw refuse("date: must be a YYYY-MM-DD calendar date when given.");
  if (note !== undefined && (typeof note !== "string" || !note.trim() || note.length > STAGE_HISTORY_NOTE_MAX_LENGTH)) {
    throw refuse(`note: must be non-blank text of at most ${STAGE_HISTORY_NOTE_MAX_LENGTH} characters when given.`);
  }
  const id = newStageEntryId();
  const withNote = note === undefined ? {} : { note: note as string };
  return type === "interview"
    ? { id, type, kind: kind as InterviewKind, at, ...withNote }
    : { id, type: type as "response" | "followup", at, ...withNote };
}

export async function logApplicationEvent(workspaceDir: string, id: string, body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw refuse("Send a JSON object with type.");
  const request = body as Record<string, unknown>;
  const entry = eventEntry(request);
  const { baseUpdatedAt } = request;
  if (baseUpdatedAt !== undefined && (typeof baseUpdatedAt !== "string" || baseUpdatedAt.length > 100)) {
    throw refuse("baseUpdatedAt: must be the record's updatedAt when given.");
  }

  return withApplicationsLock(async () => {
    const snapshot = await readApplicationsSnapshot(workspaceDir);
    const current = snapshot.applications.find((application) => application.id === id);
    if (!current) throw new ApplicationsStorageError("Application not found.", 404);
    if (baseUpdatedAt !== undefined && baseUpdatedAt !== current.updatedAt) {
      throw new ApplicationsStorageError(
        "This application changed since it was read. Review the current record before logging an event.",
        409,
        [current]
      );
    }
    if (!current.appliedAt) throw refuse("Only a submitted application has a timeline; this record has no application date.");
    const saved = withEntrySaved(current, entry);
    if ((saved.stageHistory?.length ?? 0) > STAGE_HISTORY_MAX_ENTRIES) throw refuse(STAGE_HISTORY_FULL_MESSAGE);
    const next = { ...current, ...saved, updatedAt: nextApplicationRevision(current.updatedAt) };
    const reconciled = reconcileApplicationMutations(
      snapshot.applications,
      sanitizeApplications([next]),
      [{ id, operation: "upsert", baseUpdatedAt: current.updatedAt }]
    );
    const written = await writeApplicationsSnapshot(workspaceDir, reconciled);
    return {
      application: written.applications.find((application) => application.id === id),
      revision: written.revision,
      entry,
      statusChanged: saved.status !== current.status
    };
  });
}
