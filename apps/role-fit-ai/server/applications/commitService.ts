// One atomic write for an application decision or a Draft: the tracker record
// and its editable document sources land together or not at all. Built for
// callers outside the browser (the local MCP server), so every refusal names the
// field at fault and nothing a caller sent is lost or altered, beyond the
// documented skip-reason order and answer stamps. A dry run answers exactly as
// the commit would, without writing.

import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";

import { parseCoverLetterFile } from "@typeset/engine/lib/coverLetter.ts";
import { parseResumeFile } from "@typeset/engine/lib/resumeFile.ts";
import {
  APPLICATION_DOCUMENT_KINDS,
  DOCUMENT_SOURCE_EXTENSION,
  MAX_DOCUMENT_BYTES,
  writeApplicationFile,
  type ApplicationDocumentKind
} from "./documents.ts";
import { answerForRecord, answerIssues } from "./answerService.ts";
import { documentArtifacts } from "./documentService.ts";
import { reconcileApplicationMutations } from "./reconcile.ts";
import { applicationDocumentDir } from "./routeSupport.ts";
import { findDuplicateApplications, type DuplicateMatch, type DuplicateTarget } from "../../src/lib/jobIdentity.ts";
import { normalizeNotApplyingReasons } from "../../src/lib/notApplying.ts";
import {
  isCanonicalApplicationTimestamp,
  sanitizeApplications,
  strictApplicationIssues
} from "./schema.ts";
import {
  assertTrackerCapacity,
  readApplicationsSnapshot,
  withApplicationsLock,
  writeApplicationsSnapshot
} from "./storage.ts";

export const COMMIT_STATUSES = ["applied", "not_applying", "draft"] as const;
export const MAX_ACKNOWLEDGED_DUPLICATES = 100;
const COMMIT_FIELDS = ["application", "documents", "dryRun", "acknowledgedDuplicates"];

// The server assigns identity, revisions and file metadata; posting groups and
// history are separate, revision-checked mutations of existing records.
const SERVER_OWNED_FIELDS = [
  "id",
  "createdAt",
  "updatedAt",
  "resumeArtifacts",
  "coverLetterArtifacts",
  "attachments",
  "stageHistory",
  "jobPostingGroupId"
] as const;

type DuplicateSummary = Record<string, unknown> & { id: string; match: Omit<DuplicateMatch, "application"> };

export class ApplicationCommitError extends Error {
  status: number;
  issues: string[];
  duplicates?: DuplicateSummary[];
  constructor(issues: string[], status = 400, duplicates?: DuplicateSummary[]) {
    super("The application was not saved. Fix the listed fields and commit again.");
    this.name = "ApplicationCommitError";
    this.status = status;
    this.issues = issues;
    this.duplicates = duplicates;
  }
}

type CommitDocument = { kind: ApplicationDocumentKind; sourceText: string; fileName: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

function commitDocuments(raw: unknown, issues: string[]): CommitDocument[] {
  if (raw === undefined) return [];
  if (!isObject(raw)) {
    issues.push("documents: must be an object with optional resume and cover entries");
    return [];
  }
  const documents: CommitDocument[] = [];
  for (const [kind, value] of Object.entries(raw)) {
    const path = `documents.${kind}`;
    if (!(APPLICATION_DOCUMENT_KINDS as readonly string[]).includes(kind)) {
      issues.push(`${path}: unknown document kind (use resume or cover)`);
      continue;
    }
    const documentKind = kind as ApplicationDocumentKind;
    if (!isObject(value)) {
      issues.push(`${path}: must be an object with sourceText`);
      continue;
    }
    const unknownKey = Object.keys(value).find((key) => key !== "sourceText" && key !== "fileName");
    if (unknownKey) issues.push(`${path}.${unknownKey}: not a document field`);
    const { sourceText, fileName } = value;
    if (typeof sourceText !== "string" || !sourceText) {
      issues.push(`${path}.sourceText: required editable .${DOCUMENT_SOURCE_EXTENSION[documentKind]} source`);
      continue;
    }
    if (Buffer.byteLength(sourceText, "utf8") > MAX_DOCUMENT_BYTES) {
      issues.push(`${path}.sourceText: larger than ${MAX_DOCUMENT_BYTES} bytes`);
      continue;
    }
    try {
      if (documentKind === "resume") parseResumeFile(sourceText);
      else parseCoverLetterFile(sourceText);
    } catch {
      issues.push(`${path}.sourceText: not a valid .${DOCUMENT_SOURCE_EXTENSION[documentKind]} document`);
      continue;
    }
    if (fileName !== undefined && (typeof fileName !== "string" || !fileName.trim() || fileName.length > 200)) {
      issues.push(`${path}.fileName: must be a non-empty string of at most 200 characters when given`);
      continue;
    }
    documents.push({
      kind: documentKind,
      sourceText,
      fileName: fileName ?? `${documentKind}.${DOCUMENT_SOURCE_EXTENSION[documentKind]}`
    });
  }
  return documents;
}

// The tracker keeps skip reasons in one canonical order; a list that differs
// only in order is reordered, while an unknown or repeated reason stays as sent
// so the strict check names it.
function canonicalSkipReasons(reasons: unknown) {
  if (!Array.isArray(reasons)) return reasons;
  const canonical = normalizeNotApplyingReasons(reasons);
  return canonical.length === reasons.length ? canonical : reasons;
}

// Validates the whole request, then builds the exact record to store. Throws
// ApplicationCommitError listing every problem found.
function prepareCommit(body: unknown, now: string) {
  if (!isObject(body) || !isObject(body.application)) {
    throw new ApplicationCommitError(["application: required object"]);
  }
  const issues: string[] = [];
  const unknownKey = Object.keys(body).find((key) => !COMMIT_FIELDS.includes(key));
  if (unknownKey) issues.push(`${unknownKey}: not a commit field (send ${COMMIT_FIELDS.join(", ")})`);
  if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") issues.push("dryRun: must be true or false");
  const acknowledged = body.acknowledgedDuplicates === undefined ? [] : body.acknowledgedDuplicates;
  if (!Array.isArray(acknowledged) || acknowledged.length > MAX_ACKNOWLEDGED_DUPLICATES
    || acknowledged.some((id) => typeof id !== "string" || !id)) {
    issues.push(`acknowledgedDuplicates: must be a list of at most ${MAX_ACKNOWLEDGED_DUPLICATES} record ids`);
  }
  const application = body.application;
  for (const field of SERVER_OWNED_FIELDS) {
    if (Object.hasOwn(application, field)) issues.push(`application.${field}: set by the server; omit it`);
  }
  const status = application.status;
  if (!(COMMIT_STATUSES as readonly unknown[]).includes(status)) {
    issues.push(`application.status: must be ${COMMIT_STATUSES.join(" or ")}`);
  }
  for (const field of ["appliedAt", "notApplyingAt"] as const) {
    if (application[field] !== undefined && !isCanonicalApplicationTimestamp(application[field])) {
      issues.push(`application.${field}: must be a canonical ISO timestamp such as ${now}`);
    }
  }
  if (status === "not_applying" && application.appliedAt !== undefined) {
    issues.push("application.appliedAt: a Skipped commit records a job you did not apply to; omit it");
  }
  if (status === "draft" && application.appliedAt !== undefined) {
    issues.push("application.appliedAt: a Draft has not been submitted; omit it");
  }
  if ((status === "applied" || status === "draft") && application.notApplyingAt !== undefined) {
    issues.push("application.notApplyingAt: only a Skipped commit has one");
  }
  const documents = commitDocuments(body.documents, issues);
  if (status === "not_applying" && documents.length) {
    issues.push("documents: a Skipped commit cannot store application documents");
  }
  if (status === "draft" && documents.length) {
    issues.push("documents: a Draft cannot store application documents");
  }
  if (issues.length) throw new ApplicationCommitError(issues);

  const id = randomUUID();
  const record: Record<string, unknown> = {
    ...application,
    ...(Array.isArray(application.applicationAnswers)
      ? { applicationAnswers: application.applicationAnswers.map((answer) => answerForRecord(answer, id, now)) }
      : {}),
    ...(application.notApplyingReasons !== undefined
      ? { notApplyingReasons: canonicalSkipReasons(application.notApplyingReasons) }
      : {}),
    id,
    createdAt: now,
    updatedAt: now,
    ...(status === "applied" ? { appliedAt: application.appliedAt ?? now } : {}),
    ...(status === "not_applying" ? { notApplyingAt: application.notApplyingAt ?? now } : {})
  };
  for (const document of documents) {
    record[document.kind === "resume" ? "resumeArtifacts" : "coverLetterArtifacts"] = documentArtifacts({
      hasPdf: false,
      sourceText: document.sourceText,
      fileName: document.fileName,
      savedAt: now
    });
  }
  if (Array.isArray(record.applicationAnswers)) {
    const answerProblems = answerIssues(record.applicationAnswers, id, "application.applicationAnswers");
    if (answerProblems.length) throw new ApplicationCommitError(answerProblems);
  }
  const strict = strictApplicationIssues(record);
  if (!strict.application || strict.issues.length) {
    throw new ApplicationCommitError(strict.issues.map((issue) => `application.${issue}`));
  }
  return {
    id,
    record: strict.application,
    documents,
    dryRun: body.dryRun === true,
    acknowledged: new Set(acknowledged as string[])
  };
}

// The same target the Prepare duplicate guard builds: raw posting text first.
function duplicateTarget(record: Record<string, unknown>): DuplicateTarget {
  const text = (field: string) => (typeof record[field] === "string" ? record[field] as string : undefined);
  return {
    jobUrl: text("jobUrl"),
    jobText: text("rawJobDescription")?.trim() || text("jobDescription"),
    company: text("company"),
    role: text("role"),
    location: text("location")
  };
}

// Every match must be named in acknowledgedDuplicates, as the Prepare guard
// makes the user choose before a second record for the same job is saved.
function refuseUnacknowledgedDuplicates(
  record: Record<string, unknown>,
  applications: readonly (DuplicateTarget & { id: string })[],
  acknowledged: Set<string>
) {
  const unacknowledged = findDuplicateApplications(duplicateTarget(record), applications)
    .filter(({ application }) => !acknowledged.has(application.id));
  if (!unacknowledged.length) return;
  const duplicates = unacknowledged.map(({ application, level, confidence, evidence }) => {
    const { title, company, role, status, jobUrl, appliedAt, notApplyingAt, updatedAt } = application as Record<string, unknown>;
    return { id: application.id, title, company, role, status, jobUrl, appliedAt, notApplyingAt, updatedAt, match: { level, confidence, evidence } };
  });
  throw new ApplicationCommitError([
    `acknowledgedDuplicates: this job matches ${duplicates.length === 1 ? "a saved record" : `${duplicates.length} saved records`} ` +
      `(${duplicates.map(({ id }) => id).join(", ")}). If it is the same application, update that record instead; ` +
      "to save a separate record, list each id here."
  ], 409, duplicates);
}

const commitDependencies = { writeApplicationsSnapshot };

export async function commitApplication(workspaceDir: string, body: unknown, dependencies = commitDependencies) {
  const { id, record, documents, dryRun, acknowledged } = prepareCommit(body, new Date().toISOString());
  const dir = applicationDocumentDir(id, workspaceDir);
  if (!dir) throw new ApplicationCommitError(["id: could not allocate a document folder"], 500);
  return withApplicationsLock(async () => {
    const current = await readApplicationsSnapshot(workspaceDir);
    refuseUnacknowledgedDuplicates(record, current.applications, acknowledged);
    // Same mutation rules as every tracker save: unique id, answer receipts.
    const reconciled = reconcileApplicationMutations(
      current.applications,
      sanitizeApplications([record]),
      [{ id, operation: "upsert", baseUpdatedAt: null }]
    );
    if (dryRun) {
      // The write's own capacity check, which a dry run never reaches.
      assertTrackerCapacity(reconciled);
      return { dryRun: true as const, valid: true };
    }
    try {
      for (const document of documents) {
        await writeApplicationFile(
          dir,
          `${document.kind}.${DOCUMENT_SOURCE_EXTENSION[document.kind]}`,
          Buffer.from(document.sourceText, "utf8")
        );
      }
      const saved = await dependencies.writeApplicationsSnapshot(workspaceDir, reconciled);
      return {
        application: saved.applications.find((application) => application.id === id),
        revision: saved.revision
      };
    } catch (error) {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        throw new ApplicationCommitError(
          [`documents: the record was not saved, but its document folder applications/${id} could not be removed`],
          500
        );
      }
      throw error;
    }
  });
}
