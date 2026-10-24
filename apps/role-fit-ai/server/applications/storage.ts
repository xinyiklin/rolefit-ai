// Application tracker — JSON file as DB.
// Stored at <workspaceDir>/applications.json which is gitignored.

import { randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  ApplicationsStorageError,
  MAX_APPLICATIONS,
  duplicateApplicationId,
  sanitizeApplications
} from "./schema.ts";
import {
  TRACKER_FILE_NAME,
  TRACKER_SCHEMA_VERSION,
  migrateTrackerApplications,
  storedTrackerVersion
} from "./trackerVersion.ts";
import { WorkspaceNewerError } from "../../src/lib/workspaceBackupContract.ts";
import {
  assertWorkspaceAccessAllowed,
  captureWorkspaceAccess
} from "../workspaceRestoreGate.ts";

const TRACKER_FILE_KEYS = new Set(["schemaVersion", "savedAt", "applications"]);

export function applicationsFilePath(workspaceDir: string): string {
  return join(workspaceDir, TRACKER_FILE_NAME);
}

// Serialize every tracker read-modify-write cycle and any workspace-wide
// snapshot/restore that must observe applications.json and its PDF artifacts as
// one consistent state.
let applicationsWriteQueue: Promise<unknown> = Promise.resolve();
export function withApplicationsLock<T>(
  task: () => Promise<T>,
  options: { allowDuringRestore?: boolean } = {}
): Promise<T> {
  const capture = captureWorkspaceAccess();
  const run = applicationsWriteQueue.then(() => {
    if (!options.allowDuringRestore) assertWorkspaceAccessAllowed(capture);
    return task();
  });
  applicationsWriteQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

type StoredApplications = ReturnType<typeof sanitizeApplications>;

// The last fully validated tracker file, reused while the file on disk keeps the
// same identity. Any outside change (an edit, a restore, another server process)
// changes the identity and forces a full read and validation again, except a
// same-size in-place edit within the cached state's timestamp tick, which stat
// cannot see. `revision` is minted per validated load or write and never
// persisted; clients use it to skip downloading a tracker they already hold.
type TrackerSnapshot = {
  path: string;
  identity: string;
  applications: StoredApplications;
  revision: string;
};
let snapshot: TrackerSnapshot | null = null;
// Records that came out of validation (and are frozen), so a write re-sanitizes
// only the new or edited records it is given.
const validatedRecords = new WeakSet<object>();

function identityOf(details: BigIntStats): string {
  return [details.dev, details.ino, details.size, details.mtimeNs, details.ctimeNs].join(":");
}

async function fileIdentity(path: string): Promise<string | null> {
  try {
    return identityOf(await stat(path, { bigint: true }));
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

function deepFreeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}

function rememberValidated(
  path: string,
  identity: string,
  applications: StoredApplications
): TrackerSnapshot {
  for (const application of applications) {
    deepFreeze(application);
    validatedRecords.add(application);
  }
  Object.freeze(applications);
  snapshot = { path, identity, applications, revision: randomUUID() };
  return snapshot;
}

/** Drop the cached tracker so the next read fully re-validates the file. */
export function invalidateApplicationsSnapshot(): void {
  snapshot = null;
}

function isMissingFile(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export async function readApplications(workspaceDir: string) {
  return (await readApplicationsSnapshot(workspaceDir)).applications;
}

/** The validated tracker plus its in-memory revision. */
export async function readApplicationsSnapshot(
  workspaceDir: string
): Promise<{ applications: StoredApplications; revision: string }> {
  const path = applicationsFilePath(workspaceDir);
  let identity: string | null;
  try {
    identity = await fileIdentity(path);
  } catch {
    throw new ApplicationsStorageError();
  }
  const key = identity ?? "missing";
  if (snapshot?.path === path && snapshot.identity === key) return snapshot;
  if (identity === null) return rememberValidated(path, key, []);

  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return rememberValidated(path, "missing", []);
    throw new ApplicationsStorageError();
  }

  let parsed: ReturnType<typeof parseStoredApplications>;
  try {
    parsed = parseStoredApplications(text);
  } catch (error) {
    if (error instanceof WorkspaceNewerError) throw error;
    throw new ApplicationsStorageError();
  }
  // A failed rewrite (a locked file, say) is not corrupt data: serve the
  // migrated records and let the next tracker write stamp the current version.
  if (parsed.needsUpgrade && await writeApplications(workspaceDir, parsed.applications).then(() => true, () => false)) {
    return await readApplicationsSnapshot(workspaceDir);
  }
  // Keyed by the identity taken before the read: a change during the read gets
  // a new identity, so the next read validates the file again.
  return rememberValidated(path, identity, parsed.applications);
}

/**
 * Strictly parse stored tracker text. Throws unless every record is canonical
 * once migrated from the file's version; `needsUpgrade` reports a file below
 * the current version so the caller can write it back. A newer file throws
 * WorkspaceNewerError before any record is read.
 */
export function parseStoredApplications(text: string): {
  applications: StoredApplications;
  needsUpgrade: boolean;
} {
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid applications file shape.");
  }
  const file = data as Record<string, unknown>;
  const version = storedTrackerVersion(file);
  if (
    !Array.isArray(file.applications) ||
    // Versioned files have exactly this envelope; unversioned ones were never checked.
    (version > 0 && (
      Object.keys(file).some((key) => !TRACKER_FILE_KEYS.has(key)) ||
      (Object.hasOwn(file, "savedAt") && typeof file.savedAt !== "string")
    ))
  ) {
    throw new Error("Invalid applications file shape.");
  }
  const apps = file.applications;
  const migrated = migrateTrackerApplications(apps, version);
  const sane = sanitizeApplications(migrated);
  // Never silently erase an invalid on-disk record during the next write.
  if (
    apps.length > MAX_APPLICATIONS ||
    sane.length !== apps.length ||
    duplicateApplicationId(sane) ||
    !isDeepStrictEqual(migrated, JSON.parse(JSON.stringify(sane)))
  ) {
    throw new Error("Invalid application record.");
  }
  return { applications: sane, needsUpgrade: version < TRACKER_SCHEMA_VERSION };
}

function isValidatedRecord(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && validatedRecords.has(value));
}

export async function writeApplications(
  workspaceDir: string,
  applications: unknown
) {
  return (await writeApplicationsSnapshot(workspaceDir, applications)).applications;
}

/**
 * Write the tracker and return what was written with its new revision. The
 * revision is null when the file on disk could not be confirmed as this
 * write's own, so callers send the full tracker and the next read re-validates.
 */
export function assertTrackerCapacity(applications: unknown): asserts applications is unknown[] {
  if (!Array.isArray(applications) || applications.length > MAX_APPLICATIONS) {
    throw new ApplicationsStorageError(
      `The tracker supports at most ${MAX_APPLICATIONS.toLocaleString("en-US")} applications. No tracker changes were saved.`,
      400
    );
  }
}

export async function writeApplicationsSnapshot(
  workspaceDir: string,
  applications: unknown
): Promise<{ applications: StoredApplications; revision: string | null }> {
  await mkdir(workspaceDir, { recursive: true });
  const path = applicationsFilePath(workspaceDir);
  assertTrackerCapacity(applications);
  // Records still in the validated snapshot are canonical already; only new or
  // edited records (always new objects) need sanitizing.
  const pending = applications.filter((application) => !isValidatedRecord(application));
  const sanitized = sanitizeApplications(pending);
  if (sanitized.length !== pending.length) {
    throw new ApplicationsStorageError(
      "One or more applications are invalid. No tracker changes were saved.",
      400
    );
  }
  let nextSanitized = 0;
  const sane = applications.map((application) =>
    isValidatedRecord(application) ? application : sanitized[nextSanitized++]
  ) as StoredApplications;
  if (duplicateApplicationId(sane)) {
    throw new ApplicationsStorageError(
      "Application ids must be unique. No tracker changes were saved.",
      400
    );
  }
  const payload = JSON.stringify(
    { schemaVersion: TRACKER_SCHEMA_VERSION, savedAt: new Date().toISOString(), applications: sane },
    null,
    2
  );
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let written: BigIntStats;
  try {
    await writeFile(temporaryPath, payload, { encoding: "utf8", mode: 0o600 });
    written = await stat(temporaryPath, { bigint: true });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  // Cache only the file this write produced. An outside replace after the
  // rename has another inode; an in-place edit changes size or mtime unless it
  // lands in the same timestamp tick (rename itself may change ctime, so ctime
  // is not compared here).
  const current = await stat(path, { bigint: true }).catch(() => null);
  if (
    current &&
    current.dev === written.dev &&
    current.ino === written.ino &&
    current.size === written.size &&
    current.mtimeNs === written.mtimeNs
  ) {
    return rememberValidated(path, identityOf(current), sane);
  }
  invalidateApplicationsSnapshot();
  return { applications: sane, revision: null };
}
