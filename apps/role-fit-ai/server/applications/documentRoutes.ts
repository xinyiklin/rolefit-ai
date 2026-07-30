// Persist and stream the strict editable source or explicit PDF that went out
// with one tracked application.
//
// Browser-mode callers retain jobWorkspaceDir as the default; embedded runtimes
// inject their writable workspace directory through the route boundary. The
// write queue remains module-level because the server instantiates these routes
// exactly once.

import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody, sendJson } from "../http.ts";
import { base64ToBuffer } from "../base64.ts";
import { jobWorkspaceDir } from "../workspace.ts";
import { parseCoverLetterFile } from "@typeset/engine/lib/coverLetter.ts";
import { parseResumeFile } from "@typeset/engine/lib/resumeFile.ts";
import {
  ApplicationDocumentError,
  DOCUMENT_SOURCE_EXTENSION,
  MAX_DOCUMENT_BYTES,
  attachmentDisposition,
  type ApplicationDocumentKind
} from "./documents.ts";
import { ApplicationsStorageError } from "./schema.ts";
import {
  persistApplicationDocument,
  readApplicationDocument
} from "./documentService.ts";
import {
  applicationDocumentDir,
  restoreConflictHandled
} from "./routeSupport.ts";

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

    if (sourceText) {
      try {
        if (kind === "resume") parseResumeFile(sourceText);
        else parseCoverLetterFile(sourceText);
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

    const result = await persistApplicationDocument({
      workspaceDir,
      id,
      kind,
      baseUpdatedAt: body.baseUpdatedAt,
      fileName,
      sourceOrigin,
      sourceText,
      sourceBuffer,
      pdfBuffer,
      remove: req.method === "DELETE"
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
    const data = await readApplicationDocument(
      workspaceDir,
      id,
      kind,
      format
    );
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
