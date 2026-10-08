import type { Application } from "../hooks/useApplications.ts";
import { isJobOnlySkippedApplication } from "./applicationDisplay.ts";
import { normalizeNotApplyingReasons, type NotApplyingReason } from "./notApplying.ts";
import type { PreparationSession } from "./preparationSession.ts";

export type NotApplyingCommit = {
  operation: "create" | "update";
  application: Application;
};

function mergeDefinedApplication(
  existing: Application,
  prepared: Application
): Application {
  const merged = { ...existing } as Application;
  for (const [key, value] of Object.entries(prepared)) {
    if (value !== undefined) {
      (merged as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

const SUBMISSION_FIELDS = [
  "appliedAt",
  "resumeUsed",
  "resumeArtifacts",
  "coverLetterArtifacts",
  "attachments"
] as const satisfies readonly (keyof Application)[];

export function withoutSubmittedApplicationArtifacts(application: Application): Application {
  const clean = { ...application };
  for (const field of SUBMISSION_FIELDS) delete clean[field];
  return clean;
}

// A Skipped record with an application date (the server's and Application
// Detail's rule) keeps what was sent: its date, documents, and their AI receipts.
// Drafts and job-only decisions keep none of it.
function withSubmissionHistory(application: Application, target: Application | null): Application {
  const jobOnly = withoutSubmittedApplicationArtifacts(application);
  if (!target || target.status !== "not_applying" || isJobOnlySkippedApplication(target)) return jobOnly;
  const history = Object.fromEntries(
    SUBMISSION_FIELDS.flatMap((field) => target[field] === undefined ? [] : [[field, target[field]]])
  ) as Partial<Application>;
  return { ...jobOnly, ...history, aiUsage: { ...target.aiUsage, ...jobOnly.aiUsage } };
}

function withDecision(
  application: Application,
  target: Application | null,
  now: string,
  reasons: readonly NotApplyingReason[],
  note: string
): Application {
  const normalizedReasons = normalizeNotApplyingReasons(reasons);
  const next = withSubmissionHistory({
    ...application,
    status: "not_applying",
    notApplyingAt: now,
    notApplyingReasons: normalizedReasons,
    notApplyingNote: note.trim().slice(0, 2_000) || undefined
  }, target);
  if (!normalizedReasons.length) delete next.notApplyingReasons;
  if (!note.trim()) delete next.notApplyingNote;
  return next;
}

export function skipApplicationForSession({
  session,
  prepared,
  matchedNotApplying,
  existingDraft = null,
  now,
  reasons,
  note,
  clearFields = []
}: {
  session: PreparationSession;
  prepared: Application;
  matchedNotApplying: Application | null;
  existingDraft?: Application | null;
  now: string;
  reasons: readonly NotApplyingReason[];
  note: string;
  clearFields?: readonly (keyof Application)[];
}): NotApplyingCommit | null {
  if (session.mode === "update" && (!existingDraft || existingDraft.id !== session.applicationId || existingDraft.status !== "draft")) return null;

  const target = session.mode === "update" ? existingDraft : matchedNotApplying;
  if (matchedNotApplying && matchedNotApplying.status !== "not_applying") return null;

  if (!target) {
    return {
      operation: "create",
      application: withDecision(prepared, null, now, reasons, note)
    };
  }

  const merged = mergeDefinedApplication(target, prepared);
  for (const field of clearFields) delete merged[field];
  return {
    operation: "update",
    application: withDecision({
      ...merged,
      id: target.id,
      createdAt: target.createdAt
    }, target, now, reasons, note)
  };
}

export function updateNotApplyingJob({
  session,
  prepared,
  existing,
  clearFields = []
}: {
  session: PreparationSession;
  prepared: Application;
  existing: Application | null;
  clearFields?: readonly (keyof Application)[];
}): NotApplyingCommit | null {
  if (
    session.mode !== "update"
    || !existing
    || existing.id !== session.applicationId
    || existing.status !== "not_applying"
  ) return null;

  const merged = mergeDefinedApplication(existing, prepared);
  for (const field of clearFields) delete merged[field];
  return {
    operation: "update",
    application: withSubmissionHistory({
      ...merged,
      id: existing.id,
      createdAt: existing.createdAt,
      status: "not_applying",
      notApplyingAt: existing.notApplyingAt,
      notApplyingReasons: existing.notApplyingReasons,
      notApplyingNote: existing.notApplyingNote
    }, existing)
  };
}
