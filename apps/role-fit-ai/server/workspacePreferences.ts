// Canonical, workspace-resident RoleFit preferences. Browser storage is only a
// fail-open cache: every client connected to this workspace reads and writes
// this owner-only file, so changing browser, origin, or incognito mode does not
// create a separate candidate profile.

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  MAX_WORKSPACE_PREFERENCES_JSON_BYTES,
  WORKSPACE_PREFERENCES_FILE_NAME,
  WORKSPACE_PREFERENCES_FORMAT,
  WORKSPACE_PREFERENCES_SCHEMA_VERSION,
  WORKSPACE_RESTORE_MARKER_FILE_NAME,
  WORKSPACE_RESTORE_MARKER_FORMAT,
  WORKSPACE_RESTORE_MARKER_SCHEMA_VERSION,
  parsePortableWorkspacePreferences,
  parseStoredWorkspacePreferences,
  parseStoredWorkspaceRestoreMarker,
  type PortableWorkspacePreferences,
  type StoredWorkspacePreferences,
  type StoredWorkspaceRestoreMarker
} from "../src/lib/workspaceBackupContract.ts";
import { readBody, sendJson } from "./http.ts";
import { ensureJobWorkspace, withWorkspaceLock } from "./workspace.ts";
import { WorkspaceRestoreConflictError } from "./workspaceRestoreGate.ts";

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

export type StoredWorkspacePreferencesRead =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "ok"; value: StoredWorkspacePreferences };

async function readPreferencesFile(path: string): Promise<{ status: "missing" } | { status: "ok"; raw: string } | { status: "invalid" }> {
  try {
    return { status: "ok", raw: await readFile(path, "utf8") };
  } catch (error) {
    return isMissingFile(error) ? { status: "missing" } : { status: "invalid" };
  }
}

export async function readStoredWorkspacePreferences(workspaceDir: string): Promise<StoredWorkspacePreferencesRead> {
  const current = await readPreferencesFile(join(workspaceDir, WORKSPACE_PREFERENCES_FILE_NAME));
  if (current.status === "ok") {
    try {
      return { status: "ok", value: parseStoredWorkspacePreferences(JSON.parse(current.raw) as unknown) };
    } catch {
      return { status: "invalid" };
    }
  }
  return current;
}

export type StoredWorkspaceRestoreMarkerRead =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "ok"; value: StoredWorkspaceRestoreMarker };

export async function readStoredWorkspaceRestoreMarker(workspaceDir: string): Promise<StoredWorkspaceRestoreMarkerRead> {
  let raw: string;
  try {
    raw = await readFile(join(workspaceDir, WORKSPACE_RESTORE_MARKER_FILE_NAME), "utf8");
  } catch (error) {
    if (isMissingFile(error)) return { status: "missing" };
    return { status: "invalid" };
  }
  try {
    return { status: "ok", value: parseStoredWorkspaceRestoreMarker(JSON.parse(raw) as unknown) };
  } catch {
    return { status: "invalid" };
  }
}

function serializeStoredWorkspacePreferences(
  preferences: PortableWorkspacePreferences,
  source: StoredWorkspacePreferences["source"],
  now: Date
): string {
  const stored: StoredWorkspacePreferences = {
    format: WORKSPACE_PREFERENCES_FORMAT,
    schemaVersion: WORKSPACE_PREFERENCES_SCHEMA_VERSION,
    updatedAt: now.toISOString(),
    source,
    settings: preferences.settings,
    lastBaseResume: preferences.lastBaseResume
  };
  return JSON.stringify(stored, null, 2);
}

export async function writeStoredWorkspacePreferences(
  targetDir: string,
  preferences: PortableWorkspacePreferences,
  source: StoredWorkspacePreferences["source"],
  now: Date
): Promise<void> {
  await writeFile(
    join(targetDir, WORKSPACE_PREFERENCES_FILE_NAME),
    serializeStoredWorkspacePreferences(preferences, source, now),
    { mode: 0o600 }
  );
}

export async function writeWorkspaceRestoreMarker(targetDir: string, now: Date): Promise<void> {
  const marker: StoredWorkspaceRestoreMarker = {
    format: WORKSPACE_RESTORE_MARKER_FORMAT,
    schemaVersion: WORKSPACE_RESTORE_MARKER_SCHEMA_VERSION,
    restoredAt: now.toISOString()
  };
  await writeFile(
    join(targetDir, WORKSPACE_RESTORE_MARKER_FILE_NAME),
    JSON.stringify(marker, null, 2),
    { mode: 0o600 }
  );
}

async function writePreferencesAtomic(
  workspaceDir: string,
  preferences: PortableWorkspacePreferences,
  now: Date
): Promise<void> {
  const filePath = join(workspaceDir, WORKSPACE_PREFERENCES_FILE_NAME);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      serializeStoredWorkspacePreferences(preferences, "workspace", now),
      { mode: 0o600 }
    );
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export class InvalidWorkspacePreferencesError extends Error {
  constructor() {
    super("The canonical workspace preferences file is invalid.");
    this.name = "InvalidWorkspacePreferencesError";
  }
}

// Refuse to turn an ordinary browser-cache save into an implicit repair. The
// validity check and replacement share the workspace lock so a concurrent
// restore cannot change the file between them.
export async function persistWorkspacePreferences(
  workspaceDir: string,
  preferences: PortableWorkspacePreferences,
  now = new Date()
): Promise<void> {
  await withWorkspaceLock(async () => {
    const current = await readStoredWorkspacePreferences(workspaceDir);
    if (current.status === "invalid") throw new InvalidWorkspacePreferencesError();
    await ensureJobWorkspace(workspaceDir);
    await writePreferencesAtomic(workspaceDir, preferences, now);
  });
}

async function handleGet(res: ServerResponse, workspaceDir: string): Promise<void> {
  let read: StoredWorkspacePreferencesRead;
  let marker: StoredWorkspaceRestoreMarkerRead;
  try {
    [read, marker] = await withWorkspaceLock(() => Promise.all([
      readStoredWorkspacePreferences(workspaceDir),
      readStoredWorkspaceRestoreMarker(workspaceDir)
    ]));
  } catch (error) {
    if (error instanceof WorkspaceRestoreConflictError) {
      sendJson(res, 409, { error: error.message });
      return;
    }
    sendJson(res, 500, { error: "The workspace preferences could not be read." });
    return;
  }
  const restoreStamp = marker.status === "ok"
    ? marker.value.restoredAt
    : read.status === "ok" && read.value.source === "restore"
      ? read.value.updatedAt
      : null;
  if (read.status === "missing") {
    sendJson(res, 200, { exists: false, restoreStamp });
    return;
  }
  if (read.status === "invalid") {
    sendJson(res, 200, { exists: false, invalid: true, restoreStamp });
    return;
  }
  sendJson(res, 200, {
    exists: true,
    source: read.value.source,
    updatedAt: read.value.updatedAt,
    settings: read.value.settings,
    lastBaseResume: read.value.lastBaseResume,
    restoreStamp
  });
}

async function handlePost(req: IncomingMessage, res: ServerResponse, workspaceDir: string): Promise<void> {
  let preferences: PortableWorkspacePreferences;
  try {
    const raw = await readBody(req, MAX_WORKSPACE_PREFERENCES_JSON_BYTES);
    preferences = parsePortableWorkspacePreferences(JSON.parse(raw) as unknown);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "Request is too large.";
    sendJson(res, tooLarge ? 413 : 400, {
      error: tooLarge
        ? "The workspace preferences are larger than the supported limit."
        : "The workspace preferences are invalid."
    });
    return;
  }
  try {
    await persistWorkspacePreferences(workspaceDir, preferences);
  } catch (error) {
    if (error instanceof WorkspaceRestoreConflictError) {
      sendJson(res, 409, { error: error.message });
      return;
    }
    if (error instanceof InvalidWorkspacePreferencesError) {
      sendJson(res, 409, {
        error: "The canonical workspace preferences file is invalid. Repair or restore it before saving settings."
      });
      return;
    }
    sendJson(res, 500, { error: "The workspace preferences could not be saved." });
    return;
  }
  sendJson(res, 200, { saved: true });
}

export async function handleWorkspacePreferences(
  req: IncomingMessage,
  res: ServerResponse,
  workspaceDir: string
): Promise<void> {
  if (req.method === "GET") {
    await handleGet(res, workspaceDir);
    return;
  }
  if (req.method === "POST") {
    await handlePost(req, res, workspaceDir);
    return;
  }
  sendJson(res, 405, { error: "Use GET or POST." });
}
