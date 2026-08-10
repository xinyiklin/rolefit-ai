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
        ...(session.pendingRelationship?.jobPostingGroupId
          ? { jobPostingGroupId: session.pendingRelationship.jobPostingGroupId }
          : {}),
        status: "applied",
        appliedAt: now
      }
    };
  }

  if (!existing || existing.id !== session.applicationId) return null;
  const merged = mergeDefinedApplication(existing, prepared);
  for (const field of clearFields) delete merged[field];
  if (session.mode === "draft") {
    if (existing.status !== "interested") return null;
    return {
      operation: "update",
      application: {
        ...merged,
        id: existing.id,
        createdAt: existing.createdAt,
        status: "applied",
        appliedAt: existing.appliedAt ?? now,
        ...(session.pendingRelationship?.jobPostingGroupId
          ? { jobPostingGroupId: session.pendingRelationship.jobPostingGroupId }
          : {})
      }
    };
  }

  return {
    operation: "update",
    application: {
      ...merged,
      id: existing.id,
      createdAt: existing.createdAt,
      status: existing.status,
      appliedAt: existing.appliedAt
    }
  };
}
