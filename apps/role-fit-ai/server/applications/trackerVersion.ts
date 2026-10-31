// applications.json format versions and the migrations between them (D095).
// A file without `schemaVersion` is the unversioned legacy format, version 0.
// Each migration upgrades exactly one version and runs only on files at that
// version; every later strictness check still applies to its output.

import { readableSchemaVersion } from "../../src/lib/workspaceBackupContract.ts";

export const TRACKER_SCHEMA_VERSION = 1;
export const TRACKER_FILE_NAME = "applications.json";

const REMOVED_APPLICATION_PRIORITIES = new Set(["High", "Medium", "Low"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

// Version 0 → 1: the lossless upgrades earlier builds applied on every read.
// - The retired High/Medium/Low priority is removed; any other value stays and
//   fails validation.
// - The retired `interested` stage becomes a Skipped decision dated by its last
//   revision, without sent-document metadata, since nothing was submitted.
// - An exactly empty `appliedAt` is absent; no date is invented.
// - A scalar `notApplyingReason` becomes a one-item `notApplyingReasons` list;
//   a record carrying both shapes stays invalid.
// - A Fit result without `status` is an assessed result.
function migrateUnversionedApplication(application: unknown): unknown {
  if (!isRecord(application)) return application;
  let raw: Record<string, unknown> = application;
  if (typeof raw.priority === "string" && REMOVED_APPLICATION_PRIORITIES.has(raw.priority)) {
    const { priority: _priority, ...withoutPriority } = raw;
    raw = withoutPriority;
  }
  if (raw.status === "interested") {
    const {
      appliedAt: _appliedAt,
      resumeUsed: _resumeUsed,
      resumeArtifacts: _resumeArtifacts,
      coverLetterArtifacts: _coverLetterArtifacts,
      attachments: _attachments,
      ...preserved
    } = raw;
    raw = { ...preserved, status: "not_applying", notApplyingAt: raw.updatedAt };
  }
  if (raw.appliedAt === "") {
    const { appliedAt: _emptyDate, ...preserved } = raw;
    raw = preserved;
  }
  if (Object.hasOwn(raw, "notApplyingReason") && !Object.hasOwn(raw, "notApplyingReasons")) {
    const { notApplyingReason, ...preserved } = raw;
    raw = { ...preserved, notApplyingReasons: [notApplyingReason] };
  }
  const fitAssessment = raw.fitAssessment;
  if (isRecord(fitAssessment) && isRecord(fitAssessment.result) && !Object.hasOwn(fitAssessment.result, "status")) {
    raw = {
      ...raw,
      fitAssessment: { ...fitAssessment, result: { ...fitAssessment.result, status: "ASSESSED" } }
    };
  }
  return raw;
}

/**
 * Ids of the records in an unversioned tracker whose saved documents the
 * version 0 → 1 migration retires: a retired `interested` record keeps none.
 * A backup an older build exported still bundles those records' files.
 */
export function retiredDocumentApplicationIds(data: unknown): Set<string> {
  const ids = new Set<string>();
  if (!isRecord(data) || Object.hasOwn(data, "schemaVersion") || !Array.isArray(data.applications)) return ids;
  for (const application of data.applications) {
    if (isRecord(application) && application.status === "interested" && typeof application.id === "string") {
      ids.add(application.id);
    }
  }
  return ids;
}

// MIGRATIONS[n] upgrades the applications of a version-n file to version n + 1.
const MIGRATIONS: ReadonlyArray<(applications: unknown[]) => unknown[]> = [
  (applications) => applications.map(migrateUnversionedApplication)
];

if (MIGRATIONS.length !== TRACKER_SCHEMA_VERSION) {
  throw new Error("Every tracker schema version needs exactly one migration from the version before it.");
}

/**
 * The stored tracker's version: 0 when unversioned. Throws WorkspaceNewerError
 * for a version this build does not know and a plain Error for anything else
 * that is not a version.
 */
export function storedTrackerVersion(data: Record<string, unknown>): number {
  if (!Object.hasOwn(data, "schemaVersion")) return 0;
  const version = readableSchemaVersion(data.schemaVersion, TRACKER_SCHEMA_VERSION, TRACKER_FILE_NAME);
  if (version === null) throw new Error("Invalid applications file version.");
  return version;
}

export function migrateTrackerApplications(applications: unknown[], fromVersion: number): unknown[] {
  let migrated = applications;
  for (let version = fromVersion; version < TRACKER_SCHEMA_VERSION; version += 1) {
    migrated = MIGRATIONS[version](migrated);
  }
  return migrated;
}
