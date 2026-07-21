// Workspace-resident mirror of the browser's allowlisted preferences. The
// Electron companion cannot read browser localStorage, so the browser pushes an
// allowlisted preferences snapshot here (POST) and companion-driven backups read
// it server-side instead of the client merging preferences into the envelope. A
// restore stages the same file so the browser can adopt restored preferences on
// its next load.

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BROWSER_PREFERENCES_FILE_NAME,
  BROWSER_PREFERENCES_FORMAT,
  BROWSER_PREFERENCES_SCHEMA_VERSION,
  MAX_BROWSER_PREFERENCES_JSON_BYTES,
  WORKSPACE_RESTORE_MARKER_FILE_NAME,
  WORKSPACE_RESTORE_MARKER_FORMAT,
  WORKSPACE_RESTORE_MARKER_SCHEMA_VERSION,
  parsePortableBrowserPreferences,
  parseStoredBrowserPreferences,
  parseStoredWorkspaceRestoreMarker,
  type PortableBrowserPreferences,
  type StoredBrowserPreferences,
  type StoredWorkspaceRestoreMarker
} from "../src/lib/workspaceBackupContract.ts";
import { readBody, sendJson } from "./http.ts";
import { ensureJobWorkspace, withWorkspaceLock } from "./workspace.ts";

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

// A missing mirror and a corrupt/unreadable mirror are distinct: a backup omits
// preferences on both, but the GET route reports `invalid` so the browser can
// tell "never mirrored" from "mirror is damaged".
export type StoredBrowserPreferencesRead =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "ok"; value: StoredBrowserPreferences };

export async function readStoredBrowserPreferences(workspaceDir: string): Promise<StoredBrowserPreferencesRead> {
  let raw: string;
  try {
    raw = await readFile(join(workspaceDir, BROWSER_PREFERENCES_FILE_NAME), "utf8");
  } catch (error) {
    if (isMissingFile(error)) return { status: "missing" };
    return { status: "invalid" };
  }
  try {
    return { status: "ok", value: parseStoredBrowserPreferences(JSON.parse(raw) as unknown) };
  } catch {
    return { status: "invalid" };
  }
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

function serializeStoredBrowserPreferences(
  preferences: PortableBrowserPreferences,
  source: StoredBrowserPreferences["source"],
  now: Date
): string {
  const stored: StoredBrowserPreferences = {
    format: BROWSER_PREFERENCES_FORMAT,
    schemaVersion: BROWSER_PREFERENCES_SCHEMA_VERSION,
    updatedAt: now.toISOString(),
    source,
    settings: preferences.settings,
    lastBaseResume: preferences.lastBaseResume
  };
  return JSON.stringify(stored, null, 2);
}

// Direct owner-only write into a caller-controlled directory. Used by restore to
// stage the mirror inside the incoming workspace before the atomic dir swap.
export async function writeStoredBrowserPreferences(
  targetDir: string,
  preferences: PortableBrowserPreferences,
  source: StoredBrowserPreferences["source"],
  now: Date
): Promise<void> {
  await writeFile(
    join(targetDir, BROWSER_PREFERENCES_FILE_NAME),
    serializeStoredBrowserPreferences(preferences, source, now),
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

async function writeMirrorAtomic(workspaceDir: string, preferences: PortableBrowserPreferences, now: Date): Promise<void> {
  const filePath = join(workspaceDir, BROWSER_PREFERENCES_FILE_NAME);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, serializeStoredBrowserPreferences(preferences, "mirror", now), { mode: 0o600 });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function handleGet(res: ServerResponse, workspaceDir: string): Promise<void> {
  const [read, marker] = await withWorkspaceLock(() => Promise.all([
    readStoredBrowserPreferences(workspaceDir),
    readStoredWorkspaceRestoreMarker(workspaceDir)
  ]));
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
  let preferences: PortableBrowserPreferences;
  try {
    const raw = await readBody(req, MAX_BROWSER_PREFERENCES_JSON_BYTES);
    preferences = parsePortableBrowserPreferences(JSON.parse(raw) as unknown);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "Request is too large.";
    sendJson(res, tooLarge ? 413 : 400, {
      error: tooLarge ? "The browser preferences are larger than the supported limit." : "The browser preferences are invalid."
    });
    return;
  }
  try {
    await withWorkspaceLock(async () => {
      await ensureJobWorkspace(workspaceDir);
      await writeMirrorAtomic(workspaceDir, preferences, new Date());
    });
  } catch {
    sendJson(res, 500, { error: "The browser preferences could not be saved." });
    return;
  }
  sendJson(res, 200, { saved: true });
}

export async function handleBrowserPreferences(req: IncomingMessage, res: ServerResponse, workspaceDir: string): Promise<void> {
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
