// Application tracker HTTP routes: list/save/delete tracked applications and
// persist/stream a tailored resume's saved .pdf artifact. Split out of
// server.ts; the read-modify-write handlers are serialized through a
// process-local promise lock (withApplicationsLock) that guards
// applications.json against overlapping cycles.
//
// Browser-mode callers retain jobWorkspaceDir as the default; embedded runtimes
// inject their writable workspace directory through the route boundary. The
// write queue remains module-level because the server instantiates these routes
// exactly once.

import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody, sendJson } from "../http.ts";
import { base64ToBuffer } from "../base64.ts";
import { jobWorkspaceDir } from "../workspace.ts";
import { WorkspaceRestoreConflictError } from "../workspaceRestoreGate.ts";
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

// Serialize applications.json read-modify-write cycles. The merge/delete
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
      // Reconcile the client's explicit mutation set against the latest disk
      // snapshot. Unchanged rows stay server-authoritative, while changed rows
      // must still match the revision the client originally edited.
      const existing = await readApplications(workspaceDir);
      const reconciled = reconcileApplicationMutations(existing, incoming, body.mutations);
      return writeApplications(workspaceDir, reconciled);
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
      return writeApplications(workspaceDir, reconciled);
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
    await trashApplicationFiles(id, workspaceDir);
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

// Persist one document that went out with this application: its compiled PDF
// and its editable source (`.resume` / `.cover`). Both kinds take the same
// route, so neither page is the one with the better file support. The returned
// artifacts mirror the shape the application sanitizer stores.
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
    await rename(dir, join(trashDir, `${id}-${stamp}`));
  } catch {
    // No files to move, or the workspace is read-only: the record deletion the
    // user asked for has already succeeded either way.
  }
}

export async function handleSaveApplicationDocument(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  kind: ApplicationDocumentKind,
  workspaceDir = jobWorkspaceDir
): Promise<void> {
  if (req.method !== "POST") { sendJson(res, 405, { error: "Use POST." }); return; }
  const dir = applicationDocumentDir(id, workspaceDir);
  if (!dir) { sendJson(res, 400, { error: "Invalid application id." }); return; }
  try {
    // Transport cap sized for the base64 envelope of the decoded cap below
    // (4/3 inflation + JSON overhead) — with the default 8 MB readBody cap the
    // decoded 413 branch could never be reached.
    const body = JSON.parse(await readBody(req, 11_500_000));
    const pdfBase64 = typeof body.pdfBase64 === "string" ? body.pdfBase64 : "";
    const sourceText = typeof body.sourceText === "string" ? body.sourceText : "";
    const fileName = typeof body.fileName === "string" ? body.fileName.slice(0, 200) : "";
    if (!pdfBase64 && !sourceText) { sendJson(res, 400, { error: "No document to save." }); return; }

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

    const sourceFileName = `${kind}.${DOCUMENT_SOURCE_EXTENSION[kind]}`;
    const written = await withApplicationsLock(async () => {
      const result = { hasPdf: false, hasSource: false };
      if (pdfBuffer) {
        await writeApplicationFile(dir, `${kind}.pdf`, pdfBuffer);
        result.hasPdf = true;
      } else {
        // The pair is written as one snapshot. Keeping a PDF from an earlier
        // save beside a newer source would leave the record claiming a current
        // PDF that no longer matches the document.
        await rm(join(dir, `${kind}.pdf`), { force: true });
      }
      if (sourceBuffer) {
        await writeApplicationFile(dir, sourceFileName, sourceBuffer);
        result.hasSource = true;
      } else {
        await rm(join(dir, sourceFileName), { force: true });
      }
      return result;
    });
    sendJson(res, 200, {
      artifacts: { ...written, fileName, savedAt: new Date().toISOString() }
    });
  } catch (error) {
    if (restoreConflictHandled(error, res)) return;
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
    const data = await withApplicationsLock(() => readFile(join(dir, fileName)));
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
  } catch {
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

    const attachment = await withApplicationsLock(async () => {
      // A well-formed id is not proof the record exists; without this an upload
      // would create an attachments directory the tracker can never show or
      // clean up.
      const tracked = await readApplications(workspaceDir);
      if (!tracked.some((application) => application.id === id)) {
        throw new ApplicationDocumentError("That application no longer exists.", 404);
      }
      await mkdir(dir, { recursive: true });
      const existing = await readdir(dir).catch(() => [] as string[]);
      // Replacing a file of the same name is an update, not a new attachment,
      // so it never counts against the cap.
      if (!existing.includes(safe.fileName) && existing.length >= MAX_ATTACHMENTS_PER_APPLICATION) {
        throw new ApplicationDocumentError(
          `This application already has ${MAX_ATTACHMENTS_PER_APPLICATION} attachments. Remove one first.`,
          409
        );
      }
      await writeApplicationFile(dir, safe.fileName, bytes);
      return {
        fileName: safe.fileName,
        label: typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 120) : safe.fileName,
        size: bytes.length,
        contentType: attachmentContentType(safe.fileName),
        savedAt: new Date().toISOString()
      };
    });
    sendJson(res, 200, { attachment });
  } catch (error) {
    if (restoreConflictHandled(error, res)) return;
    if (error instanceof ApplicationDocumentError) {
      sendJson(res, error.status, { error: error.message });
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
  if (!safe) { sendJson(res, 404, { error: "Attachment not found." }); return; }
  const filePath = join(dir, safe.fileName);

  if (req.method === "DELETE") {
    try {
      await withApplicationsLock(() => rm(filePath, { force: true }));
      sendJson(res, 200, { fileName: safe.fileName, deleted: true });
    } catch (error) {
      if (restoreConflictHandled(error, res)) return;
      sendJson(res, 500, { error: "Removing that file failed." });
    }
    return;
  }
  if (req.method !== "GET") { sendJson(res, 405, { error: "Use GET or DELETE." }); return; }

  try {
    const data = await withApplicationsLock(() => readFile(filePath));
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
  } catch {
    sendJson(res, 404, { error: "Attachment not found." });
  }
}
