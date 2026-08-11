import type { Application } from "../hooks/useApplications.ts";
import type { NotApplyingReason } from "./notApplying.ts";
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

export function withoutSubmittedApplicationArtifacts(application: Application): Application {
  const clean = { ...application };
  delete clean.appliedAt;
  delete clean.resumeUsed;
  delete clean.resumeArtifacts;
  delete clean.coverLetterArtifacts;
  delete clean.attachments;
  return clean;
}

function withDecision(
  application: Application,
  now: string,
  reason: NotApplyingReason | "",
  note: string
): Application {
  const next = withoutSubmittedApplicationArtifacts({
    ...application,
    status: "not_applying",
    notApplyingAt: now,
    notApplyingReason: reason || undefined,
    notApplyingNote: note.trim().slice(0, 2_000) || undefined
  });
  if (!reason) delete next.notApplyingReason;
  if (!note.trim()) delete next.notApplyingNote;
  return next;
}

export function skipApplicationForSession({
  session,
  prepared,
  matchedNotApplying,
  now,
  reason,
  note,
  clearFields = []
}: {
  session: PreparationSession;
  prepared: Application;
  matchedNotApplying: Application | null;
  now: string;
  reason: NotApplyingReason | "";
  note: string;
  clearFields?: readonly (keyof Application)[];
}): NotApplyingCommit | null {
  if (session.mode === "update") return null;

  const target = matchedNotApplying;
  if (matchedNotApplying && matchedNotApplying.status !== "not_applying") return null;

  if (!target) {
    return {
      operation: "create",
      application: withDecision(prepared, now, reason, note)
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
    }, now, reason, note)
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
    application: withoutSubmittedApplicationArtifacts({
      ...merged,
      id: existing.id,
      createdAt: existing.createdAt,
      status: "not_applying",
      notApplyingAt: existing.notApplyingAt,
      notApplyingReason: existing.notApplyingReason,
      notApplyingNote: existing.notApplyingNote
    })
  };
}
