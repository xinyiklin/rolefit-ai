// Application tracker HTTP routes: list/save/delete tracked applications and
// persist/stream their editable documents, explicit PDFs, and PDF attachments.
// Split out of server.ts; the read-modify-write handlers are serialized through a
// process-local promise lock (withApplicationsLock) that guards
// applications.json against overlapping cycles.
//
// Browser-mode callers retain jobWorkspaceDir as the default; embedded runtimes
// inject their writable workspace directory through the route boundary. The
// write queue remains module-level because the server instantiates these routes
// exactly once.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody, sendJson } from "../http.ts";
import { base64ToBuffer } from "../base64.ts";
import { jobWorkspaceDir } from "../workspace.ts";
import { WorkspaceRestoreConflictError } from "../workspaceRestoreGate.ts";
import { coverLetterPlainText, parseCoverLetterFile } from "@typeset/engine/lib/coverLetter.ts";
import { parseResumeFile } from "@typeset/engine/lib/resumeFile.ts";
import { serializeResumeData } from "../../src/lib/resumeText.ts";
import { documentSourceFingerprint } from "../../src/lib/documentSourceFingerprint.ts";
import {
  ApplicationDocumentError,
  ATTACHMENT_EXTENSIONS,
  DOCUMENT_SOURCE_EXTENSION,
  MAX_ATTACHMENTS_PER_APPLICATION,
  MAX_DOCUMENT_BYTES,
  applicationFilesDir,
  assertAttachmentBytes,
  attachmentContentType,
  attachmentDisposition,
  safeAttachmentFileName,
  writeApplicationFile,
  type ApplicationDocumentKind
} from "./documents.ts";
import {
  APPLICATION_ID_RE,
  ApplicationsStorageError,
  readApplications,
  reconcileApplicationMutations,
  sanitizeApplications,
  withApplicationsLock,
  writeApplications
} from "./index.ts";

function storageErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApplicationsStorageError ? error.message : fallback;
}

// The applications lock rejects with the restore gate's error while a companion
// restore is staging. Forward its designed 409 + reload guidance instead of the
// generic storage fallbacks (which would tell the user their request was
// malformed or the server broke).
function restoreConflictHandled(error: unknown, res: ServerResponse): boolean {
  if (!(error instanceof WorkspaceRestoreConflictError)) return false;
  sendJson(res, 409, { error: error.message });
  return true;
}

function applicationDocumentDir(id: string, workspaceDir: string): string | null {
  if (!APPLICATION_ID_RE.test(id)) return null;
  return applicationFilesDir(workspaceDir, id);
}

function applicationAttachmentsDir(id: string, workspaceDir: string): string | null {
  if (!APPLICATION_ID_RE.test(id)) return null;
  return applicationFilesDir(workspaceDir, id, "attachments");
}

export async function handleListApplications(
  req: IncomingMessage,
  res: ServerResponse,
  workspaceDir = jobWorkspaceDir
): Promise<void> {
  try {
    const applications = await withApplicationsLock(() => readApplications(workspaceDir));
    sendJson(res, 200, {
      applications,
      // The browser only needs a human-readable storage label. Do not expose
      // the host account's absolute workspace path across the HTTP boundary.
      path: "workspace/applications.json"
    });
  } catch (error) {
    if (restoreConflictHandled(error, res)) return;
    sendJson(res, 500, { error: storageErrorMessage(error, "Application list failed.") });
  }
}

// Serialize applications.json read-modify-write cycles. Tracker mutations
// handlers each read the file, derive a new list, and write it back; two
// overlapping requests (e.g. Apply clicked in two tabs at once) could both read
// the same disk state and the second write would drop the first's entry. A
// simple promise chain makes each cycle atomic within this process — sufficient
// for the single-server local app.
export async function handleSaveApplications(
  req: IncomingMessage,
  res: ServerResponse,
  workspaceDir = jobWorkspaceDir
): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    if (!Array.isArray(body.applications)) {
      sendJson(res, 400, { error: "Applications must be an array." });
      return;
    }
    const incoming = sanitizeApplications(body.applications);
    if (body.applications.length > 500 || incoming.length !== body.applications.length) {
      sendJson(res, 400, { error: "One or more applications are invalid. No tracker changes were saved." });
      return;
    }
    const applications = await withApplicationsLock(async () => {
      // Sparse and legacy full-snapshot clients share one mutation contract.
      // Unchanged rows stay server-authoritative, while changed rows must still
      // match the revision the client originally edited.
      const existing = await readApplications(workspaceDir);
      const reconciled = reconcileApplicationMutations(existing, incoming, body.mutations);
      const deletedIds = existing
        .filter((application) => !reconciled.some((candidate) => candidate.id === application.id))
        .map((application) => application.id);
      const applications = await writeApplications(workspaceDir, reconciled);
      // Ordinary delete and duplicate-merge flows use this mutation endpoint.
      // Move removed records' personal files under the same lock so no path
      // depends on the separate DELETE route.
      for (const deletedId of deletedIds) {
        await trashApplicationFiles(deletedId, workspaceDir);
      }
      return applications;
    });
    sendJson(res, 200, { applications });
  } catch (error) {
    if (restoreConflictHandled(error, res)) return;
    const status = error instanceof ApplicationsStorageError ? error.status : 400;
    sendJson(res, status, {
      error: storageErrorMessage(error, "Application save failed. Check the request and try again."),
      ...(status === 409 && error instanceof ApplicationsStorageError && Array.isArray(error.currentApplications)
        ? { applications: error.currentApplications }
        : {})
    });
  }
}

export async function handleDeleteApplication(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  workspaceDir = jobWorkspaceDir
): Promise<void> {
  if (req.method !== "DELETE") {
    sendJson(res, 405, { error: "Use DELETE." });
    return;
  }
  try {
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    const baseUpdatedAt = body.baseUpdatedAt;
    if (typeof baseUpdatedAt !== "string" || !baseUpdatedAt.trim() || baseUpdatedAt.length > 100) {
      sendJson(res, 400, { error: "Delete requires the application's current baseUpdatedAt revision." });
      return;
    }
    const applications = await withApplicationsLock(async () => {
      const existing = await readApplications(workspaceDir);
      const current = existing.find((application) => application.id === id);
      if (!current) return null;
      const filtered = existing.filter((application) => application.id !== id);
      const reconciled = reconcileApplicationMutations(existing, filtered, [
        { id, operation: "delete", baseUpdatedAt: baseUpdatedAt.trim() }
      ]);
      const applications = await writeApplications(workspaceDir, reconciled);
      // Keep the file move inside the application lock. Otherwise a same-id
      // record recreated between tracker deletion and this move could have its
      // new files swept into the old record's trash directory.
      await trashApplicationFiles(id, workspaceDir);
      return applications;
    });
    if (applications === null) {
      sendJson(res, 404, { error: "Application not found." });
      return;
    }
    // The record is gone, so its files must not linger invisibly — they include
    // documents and personal attachments the user uploaded. Soft-delete
    // (workspace `.trash/` convention) rather than unlinking: a mistaken delete
    // stays recoverable from disk. Best-effort — the tracker row is already
    // removed and a filesystem hiccup must not fail the delete.
    sendJson(res, 200, { applications });
  } catch (error) {
    if (restoreConflictHandled(error, res)) return;
    const status = error instanceof ApplicationsStorageError ? error.status : 400;
    sendJson(res, status, {
      error: storageErrorMessage(error, "Delete failed."),
      ...(status === 409 && error instanceof ApplicationsStorageError && Array.isArray(error.currentApplications)
        ? { applications: error.currentApplications }
        : {})
    });
  }
}

// Move <workspace>/applications/<id>/ into applications/.trash/<id>-<stamp>/.
// `.trash` is not a valid application id, so every directory scan that looks
// for records (backup collection included) already skips it.
async function trashApplicationFiles(id: string, workspaceDir: string): Promise<void> {
  const dir = applicationDocumentDir(id, workspaceDir);
  if (!dir) return;
  try {
    const trashDir = join(workspaceDir, "applications", ".trash");
    await mkdir(trashDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await rename(dir, join(trashDir, `${id}-${stamp}-${randomUUID()}`));
  } catch {
    // No files to move, or the workspace is read-only: the record deletion the
    // user asked for has already succeeded either way.
  }
}

// Persist one document that went out with this application. A slot contains
// either its editable source (`.resume` / `.cover`) or an explicitly uploaded
// PDF, never both. The returned artifacts mirror the tracker metadata.
export async function handleSaveApplicationDocument(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  kind: ApplicationDocumentKind,
  workspaceDir = jobWorkspaceDir
): Promise<void> {
  if (req.method !== "POST" && req.method !== "DELETE") {
    sendJson(res, 405, { error: "Use POST or DELETE." });
    return;
  }
  const dir = applicationDocumentDir(id, workspaceDir);
  if (!dir) { sendJson(res, 400, { error: "Invalid application id." }); return; }
  const sourceFileName = `${kind}.${DOCUMENT_SOURCE_EXTENSION[kind]}`;
  try {
    // Transport cap sized for the base64 envelope of the decoded cap below
    // (4/3 inflation + JSON overhead) — with the default 8 MB readBody cap the
    // decoded 413 branch could never be reached.
    const body = JSON.parse(
      await readBody(req, req.method === "POST" ? 11_500_000 : 20_000)
    ) as Record<string, unknown>;
    const pdfBase64 = req.method === "POST" && typeof body.pdfBase64 === "string" ? body.pdfBase64 : "";
    const sourceText = req.method === "POST" && typeof body.sourceText === "string" ? body.sourceText : "";
    const fileName = req.method === "POST" && typeof body.fileName === "string" ? body.fileName.slice(0, 200) : "";
    const sourceOrigin = body.sourceOrigin === "upload" ? "upload" : "editor";
    if (req.method === "POST" && !pdfBase64 && !sourceText) {
      sendJson(res, 400, { error: "No document to save." });
      return;
    }
    if (pdfBase64 && sourceText) {
      sendJson(res, 400, {
        error: "Save the editable source or an uploaded PDF, not both."
      });
      return;
    }

    let parsedResume: ReturnType<typeof parseResumeFile> | null = null;
    let parsedCover: ReturnType<typeof parseCoverLetterFile> | null = null;
    if (sourceText) {
      try {
        if (kind === "resume") parsedResume = parseResumeFile(sourceText);
        else parsedCover = parseCoverLetterFile(sourceText);
      } catch {
        sendJson(res, 400, {
          error: kind === "resume"
            ? "That file is not a valid .resume document."
            : "That file is not a valid .cover document."
        });
        return;
      }
    }

    let pdfBuffer: Buffer | null = null;
    if (pdfBase64) {
      pdfBuffer = base64ToBuffer(pdfBase64, "PDF");
      if (pdfBuffer.length > MAX_DOCUMENT_BYTES) { sendJson(res, 413, { error: "PDF too large." }); return; }
      if (pdfBuffer.length < 5 || pdfBuffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
        sendJson(res, 400, { error: "PDF data was not a valid PDF file." });
        return;
      }
    }
    const sourceBuffer = sourceText ? Buffer.from(sourceText, "utf8") : null;
    if (sourceBuffer && sourceBuffer.length > MAX_DOCUMENT_BYTES) {
      sendJson(res, 413, { error: "Document source too large." });
      return;
    }

    const result = await withApplicationsLock(async () => {
      const existing = await readApplications(workspaceDir);
      const current = requireApplicationRevision(existing, id, body.baseUpdatedAt);
      const pdfFileName = `${kind}.pdf`;
      const previousPdf = await readOptionalApplicationFile(join(dir, pdfFileName));
      const previousSource = await readOptionalApplicationFile(join(dir, sourceFileName));
      const artifacts = req.method === "DELETE"
        ? undefined
        : {
            hasPdf: Boolean(pdfBuffer),
            hasSource: Boolean(sourceBuffer),
            ...(sourceText ? { sourceFingerprint: documentSourceFingerprint(sourceText) } : {}),
            fileName,
            savedAt: new Date().toISOString()
          };
      const nextApplication = {
        ...current,
        ...(kind === "resume"
          ? req.method === "DELETE" || !sourceBuffer
            ? {
                resumeData: undefined,
                polishedText: "",
                resumeUsed: undefined,
                resumeArtifacts: artifacts
              }
            : {
                resumeData: parsedResume?.data,
                polishedText: parsedResume ? serializeResumeData(parsedResume.data) : "",
                ...(sourceOrigin === "upload" ? { resumeUsed: undefined } : {}),
                resumeArtifacts: artifacts
              }
          : req.method === "DELETE" || !sourceBuffer
            ? { coverLetterText: "", coverLetterArtifacts: artifacts }
            : {
                coverLetterText: parsedCover ? coverLetterPlainText(parsedCover.data) : "",
                coverLetterArtifacts: artifacts
              }),
        updatedAt: nextApplicationRevision(current.updatedAt)
      };
      const nextApplications = existing.map((application) =>
        application.id === id ? nextApplication : application
      );

      try {
        if (req.method === "DELETE") {
          await Promise.all([
            rm(join(dir, pdfFileName), { force: true }),
            rm(join(dir, sourceFileName), { force: true })
          ]);
        } else {
          if (pdfBuffer) await writeApplicationFile(dir, pdfFileName, pdfBuffer);
          else await rm(join(dir, pdfFileName), { force: true });
          if (sourceBuffer) await writeApplicationFile(dir, sourceFileName, sourceBuffer);
          else await rm(join(dir, sourceFileName), { force: true });
        }
        const applications = await writeApplications(workspaceDir, nextApplications);
        if (req.method === "DELETE") await rmdir(dir).catch(() => undefined);
        return {
          applications,
          application: applications.find((application) => application.id === id),
          artifacts
        };
      } catch (error) {
        await Promise.all([
          restoreApplicationFile(dir, pdfFileName, previousPdf),
          restoreApplicationFile(dir, sourceFileName, previousSource)
        ]).catch(() => undefined);
        throw error;
      }
    });
    sendJson(res, 200, {
      ...(result.artifacts ? { artifacts: result.artifacts } : { removed: true }),
      application: result.application,
      applications: result.applications
    });
  } catch (error) {
    if (restoreConflictHandled(error, res)) return;
    if (error instanceof ApplicationDocumentError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    if (error instanceof ApplicationsStorageError) {
      sendJson(res, error.status, {
        error: error.message,
        ...(error.status === 409 && Array.isArray(error.currentApplications)
          ? { applications: error.currentApplications }
          : {})
      });
      return;
    }
    if (error instanceof Error && error.message === "Request is too large.") {
      sendJson(res, 413, { error: "That document is larger than the supported limit. No file was replaced." });
      return;
    }
    const safeValidationMessage = error instanceof Error && /^PDF (?:data was not valid base64|file is too large)\.$/.test(error.message)
      ? error.message
      : null;
    sendJson(res, safeValidationMessage ? 400 : 500, {
      error: safeValidationMessage ?? "Saving the document failed. No file was replaced."
    });
  }
}

// Stream a saved document back as a download. `format` is "pdf" or the kind's
// own source extension; anything else is refused before touching the disk.
export async function handleApplicationDocumentFile(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  kind: ApplicationDocumentKind,
  format: string,
  workspaceDir = jobWorkspaceDir
): Promise<void> {
  if (req.method !== "GET") { sendJson(res, 405, { error: "Use GET." }); return; }
  const dir = applicationDocumentDir(id, workspaceDir);
  if (!dir) { sendJson(res, 400, { error: "Invalid application id." }); return; }
  if (format !== "pdf" && format !== DOCUMENT_SOURCE_EXTENSION[kind]) {
    sendJson(res, 404, { error: "Unknown document format." });
    return;
  }
  const fileName = `${kind}.${format}`;
  try {
    const data = await withApplicationsLock(async () => {
      const applications = await readApplications(workspaceDir);
      const application = applications.find((candidate) => candidate.id === id);
      const artifacts = kind === "resume"
        ? application?.resumeArtifacts
        : application?.coverLetterArtifacts;
      const isTracked = format === "pdf" ? artifacts?.hasPdf : artifacts?.hasSource;
      if (!application || !isTracked) {
        throw new ApplicationDocumentError("Saved document not found.", 404);
      }
      return readFile(join(dir, fileName));
    });
    res.writeHead(200, {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/octet-stream",
      "Content-Disposition": attachmentDisposition(fileName),
      "X-Content-Type-Options": "nosniff",
      // Same headers as the attachment route: two routes serving files from one
      // loopback origin must not disagree about how they may be loaded.
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Length": data.length,
      "Cache-Control": "no-store"
    });
    res.end(data);
  } catch (error) {
    if (restoreConflictHandled(error, res)) return;
    if (error instanceof ApplicationsStorageError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    sendJson(res, 404, { error: "Saved document not found." });
  }
}

// Store one extra file the posting asked for (transcript, portfolio, writing
// sample). Kept beside the generated documents but in its own directory, so a
// user file can never take the name of one the app writes.
export async function handleUploadApplicationAttachment(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  workspaceDir = jobWorkspaceDir
): Promise<void> {
  if (req.method !== "POST") { sendJson(res, 405, { error: "Use POST." }); return; }
  const dir = applicationAttachmentsDir(id, workspaceDir);
  if (!dir) { sendJson(res, 400, { error: "Invalid application id." }); return; }
  try {
    const body = JSON.parse(await readBody(req, 11_500_000));
    const safe = safeAttachmentFileName(typeof body.fileName === "string" ? body.fileName : "");
    if (!safe) {
      sendJson(res, 400, {
        error: `Use a file named with one of: ${ATTACHMENT_EXTENSIONS.map((ext) => `.${ext}`).join(", ")}.`
      });
      return;
    }
    const dataBase64 = typeof body.dataBase64 === "string" ? body.dataBase64 : "";
    if (!dataBase64) { sendJson(res, 400, { error: "No file contents to save." }); return; }
    const bytes = base64ToBuffer(dataBase64, "File");
    if (!bytes.length) { sendJson(res, 400, { error: "That file is empty." }); return; }
    if (bytes.length > MAX_DOCUMENT_BYTES) { sendJson(res, 413, { error: "That file is larger than the 8 MB limit." }); return; }
    assertAttachmentBytes(safe.extension, bytes);

    const result = await withApplicationsLock(async () => {
      const tracked = await readApplications(workspaceDir);
      const current = requireApplicationRevision(tracked, id, body.baseUpdatedAt);
      await mkdir(dir, { recursive: true });
      // Replacing a file of the same name is an update, not a new attachment,
      // so it never counts against the cap. The tracker is authoritative here:
      // counting directory entries can under-count a tracked-but-missing file,
      // letting an eleventh upload be written and then sanitized out of metadata.
      const trackedAttachments = current.attachments ?? [];
      if (
        !trackedAttachments.some((attachment) => attachment.fileName === safe.fileName) &&
        trackedAttachments.length >= MAX_ATTACHMENTS_PER_APPLICATION
      ) {
        throw new ApplicationDocumentError(
          `This application already has ${MAX_ATTACHMENTS_PER_APPLICATION} attachments. Remove one first.`,
          409
        );
      }
      const previousBytes = await readOptionalApplicationFile(join(dir, safe.fileName));
      const attachment = {
        fileName: safe.fileName,
        label: typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 120) : safe.fileName,
        size: bytes.length,
        contentType: attachmentContentType(safe.fileName),
        savedAt: new Date().toISOString()
      };
      const attachments = [
        ...trackedAttachments.filter((entry) => entry.fileName !== safe.fileName),
        attachment
      ];
      const nextApplication = {
        ...current,
        attachments,
        updatedAt: nextApplicationRevision(current.updatedAt)
      };
      const nextApplications = tracked.map((application) =>
        application.id === id ? nextApplication : application
      );
      try {
        await writeApplicationFile(dir, safe.fileName, bytes);
        const applications = await writeApplications(workspaceDir, nextApplications);
        return {
          attachment,
          application: applications.find((application) => application.id === id),
          applications
        };
      } catch (error) {
        await restoreApplicationFile(dir, safe.fileName, previousBytes).catch(() => undefined);
        throw error;
      }
    });
    sendJson(res, 200, result);
  } catch (error) {
    if (restoreConflictHandled(error, res)) return;
    if (error instanceof ApplicationDocumentError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    if (error instanceof ApplicationsStorageError) {
      sendJson(res, error.status, {
        error: error.message,
        ...(error.status === 409 && Array.isArray(error.currentApplications)
          ? { applications: error.currentApplications }
          : {})
      });
      return;
    }
    if (error instanceof Error && error.message === "Request is too large.") {
      sendJson(res, 413, { error: "That file is larger than the supported limit. Nothing was saved." });
      return;
    }
    const safeValidationMessage = error instanceof Error && /^File (?:data was not valid base64|file is too large)\.$/.test(error.message)
      ? error.message
      : null;
    sendJson(res, safeValidationMessage ? 400 : 500, {
      error: safeValidationMessage ?? "Saving that file failed. Nothing was saved."
    });
  }
}

export async function handleApplicationAttachmentFile(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  rawFileName: string,
  workspaceDir = jobWorkspaceDir
): Promise<void> {
  const dir = applicationAttachmentsDir(id, workspaceDir);
  if (!dir) { sendJson(res, 400, { error: "Invalid application id." }); return; }
  // Re-derive the stored name from the request rather than trusting it: only a
  // name this module would itself have written can address a file.
  const safe = safeAttachmentFileName(rawFileName);
  if (!safe || safe.fileName !== rawFileName) {
    sendJson(res, 404, { error: "Attachment not found." });
    return;
  }
  const filePath = join(dir, safe.fileName);

  if (req.method === "DELETE") {
    try {
      const body = JSON.parse(await readBody(req, 20_000)) as Record<string, unknown>;
      const result = await withApplicationsLock(async () => {
        const tracked = await readApplications(workspaceDir);
        const current = requireApplicationRevision(tracked, id, body.baseUpdatedAt);
        const previousBytes = await readOptionalApplicationFile(filePath);
        const nextApplication = {
          ...current,
          attachments: (current.attachments ?? []).filter(
            (attachment) => attachment.fileName !== safe.fileName
          ),
          updatedAt: nextApplicationRevision(current.updatedAt)
        };
        const nextApplications = tracked.map((application) =>
          application.id === id ? nextApplication : application
        );
        try {
          await rm(filePath, { force: true });
          const applications = await writeApplications(workspaceDir, nextApplications);
          return {
            fileName: safe.fileName,
            deleted: true,
            application: applications.find((application) => application.id === id),
            applications
          };
        } catch (error) {
          await restoreApplicationFile(dir, safe.fileName, previousBytes).catch(() => undefined);
          throw error;
        }
      });
      sendJson(res, 200, result);
    } catch (error) {
      if (restoreConflictHandled(error, res)) return;
      if (error instanceof ApplicationDocumentError) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      if (error instanceof ApplicationsStorageError) {
        sendJson(res, error.status, {
          error: error.message,
          ...(error.status === 409 && Array.isArray(error.currentApplications)
            ? { applications: error.currentApplications }
            : {})
        });
        return;
      }
      sendJson(res, 500, { error: "Removing that file failed. Nothing was changed." });
    }
    return;
  }
  if (req.method !== "GET") { sendJson(res, 405, { error: "Use GET or DELETE." }); return; }

  try {
    const data = await withApplicationsLock(async () => {
      const applications = await readApplications(workspaceDir);
      const application = applications.find((candidate) => candidate.id === id);
      if (
        !application?.attachments?.some(
          (attachment) => attachment.fileName === safe.fileName
        )
      ) {
        throw new ApplicationDocumentError("Attachment not found.", 404);
      }
      return readFile(filePath);
    });
    res.writeHead(200, {
      // A user-supplied file on the app's own origin is only ever a download:
      // a narrow content type plus nosniff keeps it from rendering as markup.
      "Content-Type": attachmentContentType(safe.fileName),
      "Content-Disposition": attachmentDisposition(safe.fileName),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Length": data.length,
      "Cache-Control": "no-store"
    });
    res.end(data);
  } catch (error) {
    if (restoreConflictHandled(error, res)) return;
    if (error instanceof ApplicationsStorageError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    sendJson(res, 404, { error: "Attachment not found." });
  }
}

async function readOptionalApplicationFile(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function restoreApplicationFile(dir: string, fileName: string, data: Buffer | null): Promise<void> {
  if (data) {
    await writeApplicationFile(dir, fileName, data);
  } else {
    await rm(join(dir, fileName), { force: true });
  }
}

function requireApplicationRevision(
  applications: Awaited<ReturnType<typeof readApplications>>,
  id: string,
  baseUpdatedAt: unknown
) {
  const current = applications.find((application) => application.id === id);
  if (!current) throw new ApplicationDocumentError("That application no longer exists.", 404);
  if (typeof baseUpdatedAt !== "string" || !baseUpdatedAt.trim() || baseUpdatedAt.length > 100) {
    throw new ApplicationDocumentError("The application revision is required.", 400);
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

function nextApplicationRevision(previous: string): string {
  const now = Date.now();
  const previousTime = Date.parse(previous);
  // Keep revisions monotonic even if the system clock moves backwards. The
  // optimistic-concurrency token must never reuse or regress to an older value.
  return new Date(
    Number.isFinite(previousTime) ? Math.max(now, previousTime + 1) : now
  ).toISOString();
}
