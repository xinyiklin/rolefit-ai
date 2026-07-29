import type { IncomingMessage, ServerResponse } from "node:http";

import { readBody, sendJson } from "../http.ts";
import { jobWorkspaceDir } from "../workspace.ts";
import {
  ApplicationsStorageError,
  sanitizeApplications
} from "./schema.ts";
import { reconcileApplicationMutations } from "./reconcile.ts";
import {
  readApplications,
  withApplicationsLock,
  writeApplications
} from "./storage.ts";
import {
  restoreConflictHandled,
  storageErrorMessage,
  trashApplicationFiles
} from "./routeSupport.ts";

export async function handleListApplications(
  _req: IncomingMessage,
  res: ServerResponse,
  workspaceDir = jobWorkspaceDir
): Promise<void> {
  try {
    const applications = await withApplicationsLock(() =>
      readApplications(workspaceDir)
    );
    sendJson(res, 200, {
      applications,
      path: "workspace/applications.json"
    });
  } catch (error) {
    if (restoreConflictHandled(error, res)) return;
    sendJson(res, 500, {
      error: storageErrorMessage(error, "Application list failed.")
    });
  }
}

export async function handleSaveApplications(
  req: IncomingMessage,
  res: ServerResponse,
  workspaceDir = jobWorkspaceDir
): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    if (!Array.isArray(body.applications)) {
      sendJson(res, 400, { error: "Applications must be an array." });
      return;
    }
    const incoming = sanitizeApplications(body.applications);
    if (
      body.applications.length > 500 ||
      incoming.length !== body.applications.length
    ) {
      sendJson(res, 400, {
        error:
          "One or more applications are invalid. No tracker changes were saved."
      });
      return;
    }
    const applications = await withApplicationsLock(async () => {
      const existing = await readApplications(workspaceDir);
      const reconciled = reconcileApplicationMutations(
        existing,
        incoming,
        body.mutations
      );
      const deletedIds = existing
        .filter(
          (application) =>
            !reconciled.some((candidate) => candidate.id === application.id)
        )
        .map((application) => application.id);
      const applications = await writeApplications(workspaceDir, reconciled);
      for (const deletedId of deletedIds) {
        await trashApplicationFiles(deletedId, workspaceDir);
      }
      return applications;
    });
    sendJson(res, 200, { applications });
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
        ? { applications: error.currentApplications }
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
