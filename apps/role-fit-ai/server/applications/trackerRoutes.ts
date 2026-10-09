import type { IncomingMessage, ServerResponse } from "node:http";

import { readBody, sendJson } from "../http.ts";
import { jobWorkspaceDir } from "../workspace.ts";
import {
  ApplicationsStorageError,
  MAX_APPLICATIONS,
  sanitizeApplications
} from "./schema.ts";
import { reconcileApplicationMutations } from "./reconcile.ts";
import {
  readApplications,
  readApplicationsSnapshot,
  withApplicationsLock,
  writeApplications,
  writeApplicationsSnapshot
} from "./storage.ts";
import {
  restoreConflictHandled,
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
    if (restoreConflictHandled(error, res)) return;
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
    if (restoreConflictHandled(error, res)) return;
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
    if (restoreConflictHandled(error, res)) return;
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
