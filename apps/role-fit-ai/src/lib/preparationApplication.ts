import type { Application } from "../hooks/useApplications.ts";
import type { PreparationSession } from "./preparationSession.ts";

type AppliedApplicationCommit = {
  application: Application;
  operation: "create" | "update";
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

export function appliedApplicationForSession({
  session,
  prepared,
  existing,
  now,
  clearFields = []
}: {
  session: PreparationSession;
  prepared: Application;
  existing: Application | null;
  now: string;
  clearFields?: readonly (keyof Application)[];
}): AppliedApplicationCommit | null {
  if (session.mode === "new") {
    return {
      operation: "create",
      application: {
        ...prepared,
        status: "applied",
        appliedAt: now
      }
    };
  }

  if (!existing || existing.id !== session.applicationId) return null;
  const merged = mergeDefinedApplication(existing, prepared);
  for (const field of clearFields) delete merged[field];
  return {
    operation: "update",
    application: {
      ...merged,
      id: existing.id,
      createdAt: existing.createdAt,
      status: existing.status === "draft" ? "applied" : existing.status,
      appliedAt: existing.status === "draft" ? now : existing.appliedAt
    }
  };
}

// A create refused because its id already exists is an earlier attempt of the
// same Apply or Skip whose reply was lost. The retry is a complete create, so it
// wins, including what it clears; the saved row keeps its stage and dates and
// what no create writes (later tracker edits, saved documents, posting links).
const EARLIER_ATTEMPT_FIELDS = [
  "appliedAt",
  "notApplyingAt",
  "stageHistory",
  "followupAt",
  "deadline",
  "notes",
  "interviewTips",
  "contacts",
  "resumeArtifacts",
  "coverLetterArtifacts",
  "attachments",
  "applicationAnswers",
  "duplicateDismissedIds",
  "jobPostingGroupId"
] as const satisfies readonly (keyof Application)[];

export function retriedCreateOverEarlier(
  earlier: Application,
  retried: Application
): Application {
  const merged: Application = {
    ...retried,
    id: earlier.id,
    status: earlier.status,
    createdAt: earlier.createdAt
  };
  for (const key of EARLIER_ATTEMPT_FIELDS) {
    if (earlier[key] === undefined) delete merged[key];
    else (merged as unknown as Record<string, unknown>)[key] = earlier[key];
  }
  return merged;
}
