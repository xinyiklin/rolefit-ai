// Canonical, workspace-resident RoleFit preferences. Browser storage is only a
// fail-open cache: every client connected to this workspace reads and writes
// this owner-only file, so changing browser, origin, or incognito mode does not
// create a separate candidate profile.

import { createHash } from "node:crypto";
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

// A preference revision is the hash of the stored bytes, so any writer's change
// counts, including one that leaves `updatedAt` untouched.
function preferencesRevision(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// Content and revision come from one read, so they always describe the same version.
async function readPreferencesRecord(workspaceDir: string): Promise<{ read: StoredWorkspacePreferencesRead; revision: string | null }> {
  const current = await readPreferencesFile(join(workspaceDir, WORKSPACE_PREFERENCES_FILE_NAME));
  if (current.status !== "ok") return { read: current, revision: null };
  try {
    return {
      read: { status: "ok", value: parseStoredWorkspacePreferences(JSON.parse(current.raw) as unknown) },
      revision: preferencesRevision(current.raw)
    };
  } catch {
    return { read: { status: "invalid" }, revision: null };
  }
}

export async function readStoredWorkspacePreferences(workspaceDir: string): Promise<StoredWorkspacePreferencesRead> {
  return (await readPreferencesRecord(workspaceDir)).read;
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
): Promise<string> {
  const filePath = join(workspaceDir, WORKSPACE_PREFERENCES_FILE_NAME);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const serialized = serializeStoredWorkspacePreferences(preferences, "workspace", now);
  try {
    await writeFile(temporaryPath, serialized, { mode: 0o600 });
    await rename(temporaryPath, filePath);
    return preferencesRevision(serialized);
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

export class StaleWorkspacePreferencesError extends Error {
  constructor() {
    super("The workspace preferences changed since this window last loaded them.");
    this.name = "StaleWorkspacePreferencesError";
  }
}

// Refuse to turn an ordinary browser-cache save into an implicit repair. The
// validity check and replacement share the workspace lock so a concurrent
// restore cannot change the file between them. A client save passes the
// revision it last saw; any other stored revision rejects it instead of being
// replaced. Returns the written revision.
export async function persistWorkspacePreferences(
  workspaceDir: string,
  preferences: PortableWorkspacePreferences,
  now = new Date(),
  baseRevision?: string | null
): Promise<string> {
  return withWorkspaceLock(async () => {
    const { read: current, revision } = await readPreferencesRecord(workspaceDir);
    if (current.status === "invalid") throw new InvalidWorkspacePreferencesError();
    if (baseRevision !== undefined && current.status === "ok" && revision !== baseRevision) {
      throw new StaleWorkspacePreferencesError();
    }
    await ensureJobWorkspace(workspaceDir);
    return writePreferencesAtomic(workspaceDir, preferences, now);
  });
}

// The GET payload; a stale save returns the same shape so the client can rebase.
async function readPreferencesSnapshot(workspaceDir: string): Promise<Record<string, unknown>> {
  const [{ read, revision }, marker] = await withWorkspaceLock(() => Promise.all([
    readPreferencesRecord(workspaceDir),
    readStoredWorkspaceRestoreMarker(workspaceDir)
  ]));
  const restoreStamp = marker.status === "ok"
    ? marker.value.restoredAt
    : read.status === "ok" && read.value.source === "restore"
      ? read.value.updatedAt
      : null;
  if (read.status === "missing") return { exists: false, restoreStamp };
  if (read.status === "invalid") return { exists: false, invalid: true, restoreStamp };
  return {
    exists: true,
    source: read.value.source,
    updatedAt: read.value.updatedAt,
    revision,
    settings: read.value.settings,
    lastBaseResume: read.value.lastBaseResume,
    restoreStamp
  };
}

async function handleGet(res: ServerResponse, workspaceDir: string): Promise<void> {
  let snapshot: Record<string, unknown>;
  try {
    snapshot = await readPreferencesSnapshot(workspaceDir);
  } catch (error) {
    if (error instanceof WorkspaceRestoreConflictError) {
      sendJson(res, 409, { error: error.message });
      return;
    }
    sendJson(res, 500, { error: "The workspace preferences could not be read." });
    return;
  }
  sendJson(res, 200, snapshot);
}

async function handlePost(req: IncomingMessage, res: ServerResponse, workspaceDir: string): Promise<void> {
  let preferences: PortableWorkspacePreferences;
  let baseRevision: string | null;
  try {
    const raw = await readBody(req, MAX_WORKSPACE_PREFERENCES_JSON_BYTES);
    const body = JSON.parse(raw) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
    const { baseRevision: base, ...portable } = body as Record<string, unknown>;
    if (base !== null && (typeof base !== "string" || !/^[0-9a-f]{64}$/.test(base))) throw new Error("invalid");
    baseRevision = base;
    preferences = parsePortableWorkspacePreferences(portable);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "Request is too large.";
    sendJson(res, tooLarge ? 413 : 400, {
      error: tooLarge
        ? "The workspace preferences are larger than the supported limit."
        : "The workspace preferences are invalid."
    });
    return;
  }
  let revision: string;
  try {
    revision = await persistWorkspacePreferences(workspaceDir, preferences, new Date(), baseRevision);
  } catch (error) {
    if (error instanceof StaleWorkspacePreferencesError) {
      const current = await readPreferencesSnapshot(workspaceDir).catch(() => null);
      sendJson(res, 409, { stale: true, error: error.message, ...(current ? { current } : {}) });
      return;
    }
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
  sendJson(res, 200, { saved: true, revision });
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
