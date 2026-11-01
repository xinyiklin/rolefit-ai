// A field-level repair of one saved record for callers outside the browser (the
// local MCP server), D103: set its job snapshot, notes, or resumeUsed, and
// attach a document a submitted record never received. Stage, dates, history,
// answers and identity keep their own routes; a saved document is never
// replaced, because it records what was sent.

import { join } from "node:path";

import { commitDocuments } from "./commitService.ts";
import { documentArtifacts } from "./documentService.ts";
import { DOCUMENT_SOURCE_EXTENSION, writeApplicationFile } from "./documents.ts";
import { reconcileApplicationMutations } from "./reconcile.ts";
import {
  applicationDocumentDir,
  nextApplicationRevision,
  readOptionalApplicationFile,
  restoreApplicationFile
} from "./routeSupport.ts";
import { ApplicationsStorageError, sanitizeApplications, strictApplicationIssues } from "./schema.ts";
import { RESUME_USED_VALUES } from "./statusService.ts";
import { readApplicationsSnapshot, withApplicationsLock, writeApplicationsSnapshot } from "./storage.ts";

export const UPDATABLE_FIELDS = ["jobDescription", "rawJobDescription", "fitAssessment", "notes", "resumeUsed"] as const;
const UPDATE_REQUEST_KEYS = ["fields", "documents", "baseUpdatedAt"];

export class ApplicationUpdateError extends ApplicationsStorageError {
  issues: string[];
  constructor(issues: string[]) {
    super("The application was not changed. Fix the listed fields and send it again.", 400);
    this.name = "ApplicationUpdateError";
    this.issues = issues;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const updateDependencies = { writeApplicationsSnapshot };

export async function updateApplication(workspaceDir: string, id: string, body: unknown, dependencies = updateDependencies) {
  if (!isObject(body)) throw new ApplicationUpdateError(["Send a JSON object with fields and/or documents."]);
  const issues: string[] = [];
  const unknownKey = Object.keys(body).find((key) => !UPDATE_REQUEST_KEYS.includes(key));
  if (unknownKey) issues.push(`${unknownKey}: not an update field (send ${UPDATE_REQUEST_KEYS.join(", ")})`);
  const { baseUpdatedAt } = body;
  if (baseUpdatedAt !== undefined && (typeof baseUpdatedAt !== "string" || baseUpdatedAt.length > 100)) {
    issues.push("baseUpdatedAt: must be the record's updatedAt when given");
  }
  const fields = body.fields === undefined ? {} : body.fields;
  if (!isObject(fields)) {
    issues.push("fields: must be an object");
  } else {
    for (const [key, value] of Object.entries(fields)) {
      if (!(UPDATABLE_FIELDS as readonly string[]).includes(key)) {
        issues.push(`fields.${key}: not updatable here (send ${UPDATABLE_FIELDS.join(", ")})`);
      } else if (value === null || value === undefined) {
        issues.push(`fields.${key}: send a value; fields cannot be cleared here`);
      }
    }
    if (fields.resumeUsed !== undefined && !(RESUME_USED_VALUES as readonly unknown[]).includes(fields.resumeUsed)) {
      issues.push(`fields.resumeUsed: must be ${RESUME_USED_VALUES.join(" or ")}`);
    }
  }
  const documents = commitDocuments(body.documents, issues);
  if (!issues.length && !Object.keys(fields as object).length && !documents.length) {
    issues.push("fields: send at least one field or document to change");
  }
  if (issues.length) throw new ApplicationUpdateError(issues);
  const dir = applicationDocumentDir(id, workspaceDir);
  if (!dir) throw new ApplicationsStorageError("Invalid application id.", 400);

  return withApplicationsLock(async () => {
    const snapshot = await readApplicationsSnapshot(workspaceDir);
    const current = snapshot.applications.find((application) => application.id === id);
    if (!current) throw new ApplicationsStorageError("Application not found.", 404);
    if (baseUpdatedAt !== undefined && baseUpdatedAt !== current.updatedAt) {
      throw new ApplicationsStorageError(
        "This application changed since it was read. Review the current record before changing it.",
        409,
        [current]
      );
    }
    // Drafts and job-only Skips hold no documents or resumeUsed; their first
    // submission (the status route) brings them.
    const submitted = current.status !== "draft" && !(current.status === "not_applying" && !current.appliedAt);
    const refusals: string[] = [];
    if ((fields as Record<string, unknown>).resumeUsed !== undefined && !submitted) {
      refusals.push("fields.resumeUsed: only a submitted record has one; send it with its first submission");
    }
    for (const document of documents) {
      const artifactKey = document.kind === "resume" ? "resumeArtifacts" : "coverLetterArtifacts";
      if (!submitted) {
        refusals.push(`documents.${document.kind}: a Draft or skipped job gets documents with its first submission (update_application_status)`);
      } else if (current[artifactKey]) {
        refusals.push(`documents.${document.kind}: this record already has its ${document.kind}; a saved document is never replaced`);
      }
    }
    if (refusals.length) throw new ApplicationUpdateError(refusals);

    const updatedAt = nextApplicationRevision(current.updatedAt);
    // The stored record as JSON (no undefined keys), so the strict check below
    // compares only values that exist.
    const candidate: Record<string, unknown> = {
      ...JSON.parse(JSON.stringify(current)),
      ...(fields as Record<string, unknown>),
      updatedAt,
      ...Object.fromEntries(documents.map((document) => [
        document.kind === "resume" ? "resumeArtifacts" : "coverLetterArtifacts",
        documentArtifacts({ hasPdf: false, sourceText: document.sourceText, fileName: document.fileName, savedAt: updatedAt })
      ]))
    };
    // Every value sent is stored exactly as sent, or nothing is.
    const strict = strictApplicationIssues(candidate);
    if (!strict.application || strict.issues.length) {
      throw new ApplicationUpdateError(strict.issues.map((issue) => (issue.startsWith("fields.") ? issue : `fields.${issue}`)));
    }
    const reconciled = reconcileApplicationMutations(
      snapshot.applications,
      sanitizeApplications([strict.application]),
      [{ id, operation: "upsert", baseUpdatedAt: current.updatedAt }]
    );
    const files = documents.map((document) => `${document.kind}.${DOCUMENT_SOURCE_EXTENSION[document.kind]}`);
    const previous = await Promise.all(files.map((file) => readOptionalApplicationFile(join(dir, file))));
    try {
      for (const [index, document] of documents.entries()) {
        await writeApplicationFile(dir, files[index], Buffer.from(document.sourceText, "utf8"));
      }
      const saved = await dependencies.writeApplicationsSnapshot(workspaceDir, reconciled);
      return {
        application: saved.applications.find((application) => application.id === id),
        revision: saved.revision,
        changed: true
      };
    } catch (error) {
      await Promise.all(files.map((file, index) => restoreApplicationFile(dir, file, previous[index]))).catch(() => undefined);
      throw error;
    }
  });
}
