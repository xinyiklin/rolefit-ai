// Application tracker — JSON file as DB.
// Stored at <workspaceDir>/applications.json which is gitignored.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ApplicationsStorageError,
  MAX_APPLICATIONS,
  duplicateApplicationId,
  sanitizeApplications
} from "./schema.ts";
import {
  assertWorkspaceAccessAllowed,
  captureWorkspaceAccess
} from "../workspaceRestoreGate.ts";

export function applicationsFilePath(workspaceDir: string): string {
  return join(workspaceDir, "applications.json");
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

function isMissingFile(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export async function readApplications(workspaceDir: string) {
  const path = applicationsFilePath(workspaceDir);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw new ApplicationsStorageError();
  }

  try {
    const data: unknown = JSON.parse(text);
    if (
      !data ||
      typeof data !== "object" ||
      !Array.isArray((data as { applications?: unknown }).applications)
    ) {
      throw new Error("Invalid applications file shape.");
    }
    const apps = (data as { applications: unknown[] }).applications;
    const sane = sanitizeApplications(apps);
    // Never silently erase an invalid on-disk record during the next write.
    if (
      apps.length > MAX_APPLICATIONS ||
      sane.length !== apps.length ||
      duplicateApplicationId(sane)
    ) {
      throw new Error("Invalid application record.");
    }
    return sane;
  } catch {
    throw new ApplicationsStorageError();
  }
}

export async function writeApplications(
  workspaceDir: string,
  applications: unknown
) {
  await mkdir(workspaceDir, { recursive: true });
  const path = applicationsFilePath(workspaceDir);
  if (!Array.isArray(applications) || applications.length > MAX_APPLICATIONS) {
    throw new ApplicationsStorageError(
      `The tracker supports at most ${MAX_APPLICATIONS} applications. No tracker changes were saved.`,
      400
    );
  }
  const sane = sanitizeApplications(applications);
  if (sane.length !== applications.length) {
    throw new ApplicationsStorageError(
      "One or more applications are invalid. No tracker changes were saved.",
      400
    );
  }
  if (duplicateApplicationId(sane)) {
    throw new ApplicationsStorageError(
      "Application ids must be unique. No tracker changes were saved.",
      400
    );
  }
  const payload = JSON.stringify(
    { savedAt: new Date().toISOString(), applications: sane },
    null,
    2
  );
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, payload, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  return sane;
}
