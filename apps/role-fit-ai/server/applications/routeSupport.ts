import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ServerResponse } from "node:http";

import { sendJson } from "../http.ts";
import { WorkspaceRestoreConflictError } from "../workspaceRestoreGate.ts";
import { APPLICATION_ID_RE, ApplicationsStorageError } from "./schema.ts";
import {
  ApplicationDocumentError,
  applicationFilesDir,
  writeApplicationFile
} from "./documents.ts";
import { readApplications } from "./storage.ts";

export function storageErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApplicationsStorageError ? error.message : fallback;
}

export function restoreConflictHandled(
  error: unknown,
  res: ServerResponse
): boolean {
  if (!(error instanceof WorkspaceRestoreConflictError)) return false;
  sendJson(res, 409, { error: error.message });
  return true;
}

export function applicationDocumentDir(
  id: string,
  workspaceDir: string
): string | null {
  if (!APPLICATION_ID_RE.test(id)) return null;
  return applicationFilesDir(workspaceDir, id);
}

export function applicationAttachmentsDir(
  id: string,
  workspaceDir: string
): string | null {
  const base = applicationDocumentDir(id, workspaceDir);
  return base ? join(base, "attachments") : null;
}

export async function trashApplicationFiles(
  id: string,
  workspaceDir: string
): Promise<void> {
  const dir = applicationDocumentDir(id, workspaceDir);
  if (!dir) return;
  try {
    const trashDir = join(workspaceDir, "applications", ".trash");
    await mkdir(trashDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await rename(dir, join(trashDir, `${id}-${stamp}-${randomUUID()}`));
  } catch {
    // The tracker deletion is already committed; an absent/read-only personal
    // file directory must not turn it into a false failure.
  }
}

export async function readOptionalApplicationFile(
  path: string
): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

export async function restoreApplicationFile(
  dir: string,
  fileName: string,
  data: Buffer | null
): Promise<void> {
  if (data) {
    await writeApplicationFile(dir, fileName, data);
  } else {
    await rm(join(dir, fileName), { force: true });
  }
}

export function requireApplicationRevision(
  applications: Awaited<ReturnType<typeof readApplications>>,
  id: string,
  baseUpdatedAt: unknown
) {
  const current = applications.find((application) => application.id === id);
  if (!current) {
    throw new ApplicationDocumentError(
      "That application no longer exists.",
      404
    );
  }
  if (
    typeof baseUpdatedAt !== "string" ||
    !baseUpdatedAt.trim() ||
    baseUpdatedAt.length > 100
  ) {
    throw new ApplicationDocumentError(
      "The application revision is required.",
      400
    );
  }
  if (current.updatedAt !== baseUpdatedAt.trim()) {
    throw new ApplicationsStorageError(
      "This application changed in another tab. Reload it before changing its documents.",
      409,
      applications
    );
  }
  return current;
}

export function nextApplicationRevision(previous: string): string {
  const now = Date.now();
  const previousTime = Date.parse(previous);
  return new Date(
    Number.isFinite(previousTime) ? Math.max(now, previousTime + 1) : now
  ).toISOString();
}
