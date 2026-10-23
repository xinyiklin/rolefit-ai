// A stage change applied on the server to the latest saved record, so a caller
// outside the browser never rewrites a whole record to move its stage. The
// move rule and record transform are the tracker row menu's own.

import {
  STAGE_HISTORY_FULL_MESSAGE,
  stageHistoryFits,
  withStatusChange
} from "../../src/lib/applicationStageHistory.ts";
import {
  APPLICATION_STATUSES,
  stageMenuMoveAllowed,
  type ApplicationStatus
} from "../../src/lib/applicationStatusTransitions.ts";
import { exactDayIso, toDateInput, todayIso } from "../../src/lib/dateInput.ts";
import { reconcileApplicationMutations } from "./reconcile.ts";
import { nextApplicationRevision } from "./routeSupport.ts";
import { ApplicationsStorageError, sanitizeApplications } from "./schema.ts";
import {
  readApplicationsSnapshot,
  withApplicationsLock,
  writeApplicationsSnapshot
} from "./storage.ts";

const STATUS_REQUEST_KEYS = ["status", "date", "baseUpdatedAt"];

export async function changeApplicationStatus(workspaceDir: string, id: string, body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApplicationsStorageError("Send a JSON object with status.", 400);
  }
  const request = body as Record<string, unknown>;
  const unknownKey = Object.keys(request).find((key) => !STATUS_REQUEST_KEYS.includes(key));
  if (unknownKey) throw new ApplicationsStorageError(`${unknownKey}: not a status field (send status, date, baseUpdatedAt).`, 400);
  const status = request.status;
  if (!(APPLICATION_STATUSES as readonly unknown[]).includes(status)) {
    throw new ApplicationsStorageError(`status: must be one of ${APPLICATION_STATUSES.join(", ")}.`, 400);
  }
  const nextStatus = status as ApplicationStatus;
  const { baseUpdatedAt, date } = request;
  if (baseUpdatedAt !== undefined && (typeof baseUpdatedAt !== "string" || baseUpdatedAt.length > 100)) {
    throw new ApplicationsStorageError("baseUpdatedAt: must be the record's updatedAt when given.", 400);
  }
  const at = typeof date === "string" ? exactDayIso(date) : "";
  if (date !== undefined && !at) {
    throw new ApplicationsStorageError("date: must be a YYYY-MM-DD calendar date when given.", 400);
  }

  return withApplicationsLock(async () => {
    const snapshot = await readApplicationsSnapshot(workspaceDir);
    const current = snapshot.applications.find((application) => application.id === id);
    if (!current) throw new ApplicationsStorageError("Application not found.", 404);
    if (baseUpdatedAt !== undefined && baseUpdatedAt !== current.updatedAt) {
      throw new ApplicationsStorageError(
        "This application changed since it was read. Review the current record before changing its stage.",
        409,
        [current]
      );
    }
    if (current.status === nextStatus) {
      return { application: current, revision: snapshot.revision, changed: false };
    }
    if (!stageMenuMoveAllowed(current.status, nextStatus)) {
      const allowed = APPLICATION_STATUSES.filter((candidate) => stageMenuMoveAllowed(current.status, candidate));
      throw new ApplicationsStorageError(
        `A ${current.status} record cannot move to ${nextStatus}; allowed: ${allowed.join(", ") || "none"}.`,
        400
      );
    }
    // Only a record with an application date gets a dated history entry; a
    // first submission or a Draft's Skip is dated when it is written.
    if (at) {
      // A Skip carries one decision date, notApplyingAt, which is the write time.
      if (!current.appliedAt || nextStatus === "not_applying") {
        throw new ApplicationsStorageError("date: this move is dated when it is saved; omit date.", 400);
      }
      const day = toDateInput(at);
      if (day < toDateInput(current.appliedAt) || day > toDateInput(todayIso())) {
        throw new ApplicationsStorageError("date: must fall between the application date and today.", 400);
      }
    }
    if (!stageHistoryFits(current, nextStatus)) {
      throw new ApplicationsStorageError(STAGE_HISTORY_FULL_MESSAGE, 400);
    }
    const next = withStatusChange(current, nextStatus, nextApplicationRevision(current.updatedAt), at || undefined);
    const reconciled = reconcileApplicationMutations(
      snapshot.applications,
      sanitizeApplications([next]),
      [{ id, operation: "upsert", baseUpdatedAt: current.updatedAt }]
    );
    const saved = await writeApplicationsSnapshot(workspaceDir, reconciled);
    return {
      application: saved.applications.find((application) => application.id === id),
      revision: saved.revision,
      changed: true
    };
  });
}
