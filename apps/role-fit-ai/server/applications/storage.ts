// Application tracker — JSON file as DB.
// Stored at <workspaceDir>/applications.json which is gitignored.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

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

const REMOVED_APPLICATION_PRIORITIES = new Set(["High", "Medium", "Low"]);

// Priority was optional presentation metadata, so removing it must not strand a
// canonical tracker written by an older build. Accept only the exact retired
// enum, then rewrite the file immediately without the field. Any other unknown
// or malformed value remains visible to the strict comparison and fails closed.
function removeLegacyApplicationPriorityForComparison(applications: unknown[]): {
  applications: unknown[];
  removed: boolean;
} {
  let removed = false;
  const normalized = applications.map((application) => {
    if (!application || typeof application !== "object" || Array.isArray(application)) {
      return application;
    }
    const raw = application as Record<string, unknown>;
    const legacyPriority = raw.priority;
    if (
      !Object.hasOwn(raw, "priority") ||
      typeof legacyPriority !== "string" ||
      !REMOVED_APPLICATION_PRIORITIES.has(legacyPriority)
    ) {
      return application;
    }
    const { priority: _removedPriority, ...withoutPriority } = raw;
    removed = true;
    return withoutPriority;
  });
  return { applications: normalized, removed };
}

// Saved/interested was the retired pre-Apply record. Preserve those rows as
// explicit Skipped decisions instead of deleting personal notes or making them
// look submitted. The last tracker revision becomes the decision date, while
// sent-document metadata is removed because no application was recorded.
function upgradeLegacyInterestedApplications(applications: unknown[]): {
  applications: unknown[];
  upgraded: boolean;
} {
  let upgraded = false;
  const normalized = applications.map((application) => {
    if (!application || typeof application !== "object" || Array.isArray(application)) {
      return application;
    }
    const raw = application as Record<string, unknown>;
    if (raw.status !== "interested") return application;
    const {
      appliedAt: _appliedAt,
      resumeUsed: _resumeUsed,
      resumeArtifacts: _resumeArtifacts,
      coverLetterArtifacts: _coverLetterArtifacts,
      ...preserved
    } = raw;
    upgraded = true;
    return {
      ...preserved,
      status: "not_applying",
      notApplyingAt: raw.updatedAt
    };
  });
  return { applications: normalized, upgraded };
}

// Fit Assessment summary copy is derived entirely from its verdict. Older tracker
// rows may carry the provider-generated sentence that preceded the fixed-copy
// contract, so ignore only that redundant leaf during the strict canonical
// comparison. Unknown fields and every other sanitizer change remain visible
// to isDeepStrictEqual and still fail closed.
function normalizeDerivedFitAssessmentSummariesForComparison(
  applications: unknown[],
  canonical: unknown[]
): unknown[] {
  return applications.map((application, index) => {
    if (!application || typeof application !== "object" || Array.isArray(application)) {
      return application;
    }
    const raw = application as Record<string, unknown>;
    const fitAssessment = raw.fitAssessment;
    const canonicalApplication = canonical[index];
    if (
      !fitAssessment ||
      typeof fitAssessment !== "object" ||
      Array.isArray(fitAssessment) ||
      !canonicalApplication ||
      typeof canonicalApplication !== "object" ||
      Array.isArray(canonicalApplication)
    ) {
      return application;
    }
    const result = (fitAssessment as Record<string, unknown>).result;
    const canonicalFitAssessment = (canonicalApplication as Record<string, unknown>).fitAssessment;
    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      !canonicalFitAssessment ||
      typeof canonicalFitAssessment !== "object" ||
      Array.isArray(canonicalFitAssessment)
    ) {
      return application;
    }
    const canonicalResult = (canonicalFitAssessment as Record<string, unknown>).result;
    if (!canonicalResult || typeof canonicalResult !== "object" || Array.isArray(canonicalResult)) {
      return application;
    }
    const summary = (canonicalResult as Record<string, unknown>).summary;
    const rawSummary = (result as Record<string, unknown>).summary;
    if (typeof summary !== "string" || typeof rawSummary !== "string" || !rawSummary.trim()) {
      return application;
    }
    return {
      ...raw,
      fitAssessment: {
        ...(fitAssessment as Record<string, unknown>),
        result: {
          ...(result as Record<string, unknown>),
          summary
        }
      }
    };
  });
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
    const priorityUpgrade = removeLegacyApplicationPriorityForComparison(apps);
    const interestedUpgrade = upgradeLegacyInterestedApplications(priorityUpgrade.applications);
    const sane = sanitizeApplications(interestedUpgrade.applications);
    const canonical = JSON.parse(JSON.stringify(sane)) as unknown[];
    const comparable = normalizeDerivedFitAssessmentSummariesForComparison(
      interestedUpgrade.applications,
      canonical
    );
    // Never silently erase an invalid on-disk record during the next write.
    if (
      apps.length > MAX_APPLICATIONS ||
      sane.length !== apps.length ||
      duplicateApplicationId(sane) ||
      !isDeepStrictEqual(comparable, canonical)
    ) {
      throw new Error("Invalid application record.");
    }
    if (priorityUpgrade.removed || interestedUpgrade.upgraded) {
      await writeApplications(workspaceDir, sane);
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
