import type { IncomingMessage, ServerResponse } from "node:http";

import { readBody, sendJson } from "../http.ts";
import { jobWorkspaceDir } from "../workspace.ts";
import {
  ApplicationsStorageError,
  MAX_APPLICATIONS,
  sanitizeApplications
} from "./schema.ts";
import { reconcileApplicationMutations } from "./reconcile.ts";
import { ApplicationCommitError, commitApplication } from "./commitService.ts";
import { MAX_DOCUMENT_BYTES } from "./documents.ts";
import { ApplicationAnswersError, appendApplicationAnswers } from "./answerService.ts";
import { logApplicationEvent } from "./eventService.ts";
import { changeApplicationStatus } from "./statusService.ts";
import {
  readApplications,
  readApplicationsSnapshot,
  withApplicationsLock,
  writeApplications,
  writeApplicationsSnapshot
} from "./storage.ts";
import {
  workspaceGateHandled,
  storageErrorMessage,
  trashApplicationFiles
} from "./routeSupport.ts";

// The revision names one validated tracker state. A client that already holds
// it gets 304 instead of the whole tracker.
export async function handleListApplications(
  req: IncomingMessage,
  res: ServerResponse,
  workspaceDir = jobWorkspaceDir
): Promise<void> {
  try {
    const { applications, revision } = await withApplicationsLock(() =>
      readApplicationsSnapshot(workspaceDir)
    );
    const etag = `"${revision}"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { ETag: etag, "Cache-Control": "no-store" });
      res.end();
      return;
    }
    sendJson(res, 200, {
      applications,
      revision,
      path: "workspace/applications.json"
    }, { ETag: etag });
  } catch (error) {
    if (workspaceGateHandled(error, res)) return;
    sendJson(res, 500, {
      error: storageErrorMessage(error, "Application list failed.")
    });
  }
}

// A client that sends the revision its tracker reflects gets back only the
// records it upserted plus the new id order; any other client (stale revision,
// none, or a server restart) gets the full tracker, as before.
export async function handleSaveApplications(
  req: IncomingMessage,
  res: ServerResponse,
  workspaceDir = jobWorkspaceDir
): Promise<void> {
  let currentRevision: string | null = null;
  try {
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    if (!Array.isArray(body.applications)) {
      sendJson(res, 400, { error: "Applications must be an array." });
      return;
    }
    const incoming = sanitizeApplications(body.applications);
    if (
      body.applications.length > MAX_APPLICATIONS ||
      incoming.length !== body.applications.length
    ) {
      sendJson(res, 400, {
        error:
          "One or more applications are invalid. No tracker changes were saved."
      });
      return;
    }
    const baseRevision = typeof body.baseRevision === "string" ? body.baseRevision : null;
    const saved = await withApplicationsLock(async () => {
      const current = await readApplicationsSnapshot(workspaceDir);
      currentRevision = current.revision;
      const reconciled = reconcileApplicationMutations(
        current.applications,
        incoming,
        body.mutations
      );
      const kept = new Set(reconciled.map((application) => application.id));
      const deletedIds = current.applications
        .filter((application) => !kept.has(application.id))
        .map((application) => application.id);
      const { applications, revision } = await writeApplicationsSnapshot(workspaceDir, reconciled);
      for (const deletedId of deletedIds) {
        await trashApplicationFiles(deletedId, workspaceDir);
      }
      // A null revision means the written file could not be confirmed as this
      // write's own; the client then gets the full tracker and no revision.
      return {
        applications,
        revision,
        partial: revision !== null && baseRevision === current.revision
      };
    });
    if (saved.partial) {
      const upserted = new Set(incoming.map((application) => application.id));
      sendJson(res, 200, {
        revision: saved.revision,
        order: saved.applications.map((application) => application.id),
        applications: saved.applications.filter((application) => upserted.has(application.id))
      });
      return;
    }
    sendJson(res, 200, { applications: saved.applications, revision: saved.revision });
  } catch (error) {
    if (workspaceGateHandled(error, res)) return;
    const status =
      error instanceof ApplicationsStorageError ? error.status : 400;
    sendJson(res, status, {
      error: storageErrorMessage(
        error,
        "Application save failed. Check the request and try again."
      ),
      ...(status === 409 &&
      error instanceof ApplicationsStorageError &&
      Array.isArray(error.currentApplications)
        ? { applications: error.currentApplications, revision: currentRevision }
        : {})
    });
  }
}

export async function handleDeleteApplication(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  workspaceDir = jobWorkspaceDir
): Promise<void> {
  if (req.method !== "DELETE") {
    sendJson(res, 405, { error: "Use DELETE." });
    return;
  }
  try {
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    const baseUpdatedAt = body.baseUpdatedAt;
    if (
      typeof baseUpdatedAt !== "string" ||
      !baseUpdatedAt.trim() ||
      baseUpdatedAt.length > 100
    ) {
      sendJson(res, 400, {
        error:
          "Delete requires the application's current baseUpdatedAt revision."
      });
      return;
    }
    const applications = await withApplicationsLock(async () => {
      const existing = await readApplications(workspaceDir);
      const current = existing.find((application) => application.id === id);
      if (!current) return null;
      const reconciled = reconcileApplicationMutations(existing, [], [
        { id, operation: "delete", baseUpdatedAt: baseUpdatedAt.trim() }
      ]);
      const applications = await writeApplications(workspaceDir, reconciled);
      await trashApplicationFiles(id, workspaceDir);
      return applications;
    });
    if (applications === null) {
      sendJson(res, 404, { error: "Application not found." });
      return;
    }
    sendJson(res, 200, { applications });
  } catch (error) {
    if (workspaceGateHandled(error, res)) return;
    const status =
      error instanceof ApplicationsStorageError ? error.status : 400;
    sendJson(res, status, {
      error: storageErrorMessage(error, "Delete failed."),
      ...(status === 409 &&
      error instanceof ApplicationsStorageError &&
      Array.isArray(error.currentApplications)
        ? { applications: error.currentApplications }
        : {})
    });
  }
}

// One atomic Applied, Skipped, or Draft record plus its editable document
// sources. Refusals name the fields at fault so a non-browser caller can
// correct them; a duplicate refusal also lists the matching records.
export async function handleCommitApplication(
  req: IncomingMessage,
  res: ServerResponse,
  workspaceDir = jobWorkspaceDir
): Promise<void> {
  try {
    // Two documents at the per-file cap, with room for JSON string escaping,
    // plus the record.
    const body = JSON.parse(await readBody(req, 3 * MAX_DOCUMENT_BYTES + 1_000_000)) as unknown;
    const saved = await commitApplication(workspaceDir, body);
    sendJson(res, "dryRun" in saved ? 200 : 201, saved);
  } catch (error) {
    if (workspaceGateHandled(error, res)) return;
    if (error instanceof ApplicationCommitError) {
      sendJson(res, error.status, {
        error: error.message,
        issues: error.issues,
        ...(error.duplicates ? { duplicates: error.duplicates } : {})
      });
      return;
    }
    if (error instanceof Error && error.message === "Request is too large.") {
      sendJson(res, 413, { error: "The commit is larger than the supported limit. Nothing was saved." });
      return;
    }
    const status = error instanceof ApplicationsStorageError
      ? error.status
      : error instanceof SyntaxError ? 400 : 500;
    sendJson(res, status, {
      error: status === 400 && error instanceof SyntaxError
        ? "The commit body is not valid JSON. Nothing was saved."
        : storageErrorMessage(error, "The application commit failed. Nothing was saved.")
    });
  }
}

export async function handleApplicationStatus(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  workspaceDir = jobWorkspaceDir
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }
  try {
    const body = JSON.parse(await readBody(req, 20_000)) as unknown;
    sendJson(res, 200, await changeApplicationStatus(workspaceDir, id, body));
  } catch (error) {
    sendRecordWriteError(error, res, "The stage change failed. Nothing was saved.");
  }
}

// Answers given after an application was saved, appended as new revisions.
export async function handleAppendApplicationAnswers(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  workspaceDir = jobWorkspaceDir
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }
  try {
    const body = JSON.parse(await readBody(req, 2_000_000)) as unknown;
    sendJson(res, 200, await appendApplicationAnswers(workspaceDir, id, body));
  } catch (error) {
    sendRecordWriteError(error, res, "Saving the answers failed. Nothing was saved.");
  }
}

// An interview, employer response, or follow-up added to a submitted record's timeline.
export async function handleLogApplicationEvent(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  workspaceDir = jobWorkspaceDir
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }
  try {
    const body = JSON.parse(await readBody(req, 20_000)) as unknown;
    sendJson(res, 200, await logApplicationEvent(workspaceDir, id, body));
  } catch (error) {
    sendRecordWriteError(error, res, "Logging the event failed. Nothing was saved.");
  }
}

// The per-record routes outside the browser share one error shape: a stale
// revision returns the current record, refusals keep their issues, and only
// an unexpected failure is a 500.
function sendRecordWriteError(error: unknown, res: ServerResponse, fallback: string): void {
  if (workspaceGateHandled(error, res)) return;
  const tooLarge = error instanceof Error && error.message === "Request is too large.";
  const status = error instanceof ApplicationsStorageError
    ? error.status
    : tooLarge ? 413 : error instanceof SyntaxError ? 400 : 500;
  sendJson(res, status, {
    error: tooLarge ? "The request is larger than the supported limit. Nothing was saved." : storageErrorMessage(error, fallback),
    ...(error instanceof ApplicationAnswersError ? { issues: error.issues } : {}),
    ...(status === 409 && error instanceof ApplicationsStorageError && error.currentApplications
      ? { application: error.currentApplications[0] }
      : {})
  });
}
