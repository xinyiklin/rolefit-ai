// Store and stream the extra files a posting asks for. Attachments live beside
// generated application documents but in their own namespace, so user files
// cannot replace a document slot owned by the app.

import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { readBody, sendJson } from "../http.ts";
import { base64ToBuffer } from "../base64.ts";
import { jobWorkspaceDir } from "../workspace.ts";
import {
  ApplicationDocumentError,
  ATTACHMENT_EXTENSIONS,
  MAX_ATTACHMENTS_PER_APPLICATION,
  MAX_DOCUMENT_BYTES,
  assertAttachmentBytes,
  attachmentContentType,
  attachmentDisposition,
  safeAttachmentFileName,
  writeApplicationFile
} from "./documents.ts";
import { ApplicationsStorageError } from "./schema.ts";
import {
  readApplications,
  withApplicationsLock,
  writeApplications
} from "./storage.ts";
import {
  applicationAttachmentsDir,
  assertApplicationAcceptsDocuments,
  nextApplicationRevision,
  readOptionalApplicationFile,
  requireApplicationRevision,
  restoreApplicationFile,
  restoreConflictHandled
} from "./routeSupport.ts";

export async function handleUploadApplicationAttachment(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  workspaceDir = jobWorkspaceDir
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }
  const dir = applicationAttachmentsDir(id, workspaceDir);
  if (!dir) {
    sendJson(res, 400, { error: "Invalid application id." });
    return;
  }
  try {
    const body = JSON.parse(await readBody(req, 11_500_000));
    const safe = safeAttachmentFileName(
      typeof body.fileName === "string" ? body.fileName : ""
    );
    if (!safe) {
      sendJson(res, 400, {
        error: `Use a file named with one of: ${ATTACHMENT_EXTENSIONS.map((ext) => `.${ext}`).join(", ")}.`
      });
      return;
    }
    const dataBase64 =
      typeof body.dataBase64 === "string" ? body.dataBase64 : "";
    if (!dataBase64) {
      sendJson(res, 400, { error: "No file contents to save." });
      return;
    }
    const bytes = base64ToBuffer(dataBase64, "File");
    if (!bytes.length) {
      sendJson(res, 400, { error: "That file is empty." });
      return;
    }
    if (bytes.length > MAX_DOCUMENT_BYTES) {
      sendJson(res, 413, {
        error: "That file is larger than the 8 MB limit."
      });
      return;
    }
    assertAttachmentBytes(safe.extension, bytes);

    const result = await withApplicationsLock(async () => {
      const tracked = await readApplications(workspaceDir);
      const current = requireApplicationRevision(
        tracked,
        id,
        body.baseUpdatedAt
      );
      assertApplicationAcceptsDocuments(current);
      await mkdir(dir, { recursive: true });
      // Replacing a file of the same name is an update, not a new attachment,
      // so it never counts against the cap.
      const trackedAttachments = current.attachments ?? [];
      if (
        !trackedAttachments.some(
          (attachment) => attachment.fileName === safe.fileName
        ) &&
        trackedAttachments.length >= MAX_ATTACHMENTS_PER_APPLICATION
      ) {
        throw new ApplicationDocumentError(
          `This application already has ${MAX_ATTACHMENTS_PER_APPLICATION} attachments. Remove one first.`,
          409
        );
      }
      const previousBytes = await readOptionalApplicationFile(
        join(dir, safe.fileName)
      );
      const attachment = {
        fileName: safe.fileName,
        label:
          typeof body.label === "string" && body.label.trim()
            ? body.label.trim().slice(0, 120)
            : safe.fileName,
        size: bytes.length,
        contentType: attachmentContentType(safe.fileName),
        savedAt: new Date().toISOString()
      };
      const attachments = [
        ...trackedAttachments.filter(
          (entry) => entry.fileName !== safe.fileName
        ),
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
        const applications = await writeApplications(
          workspaceDir,
          nextApplications
        );
        return {
          attachment,
          application: applications.find(
            (application) => application.id === id
          ),
          applications
        };
      } catch (error) {
        await restoreApplicationFile(
          dir,
          safe.fileName,
          previousBytes
        ).catch(() => undefined);
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
      sendJson(res, 413, {
        error:
          "That file is larger than the supported limit. Nothing was saved."
      });
      return;
    }
    const safeValidationMessage =
      error instanceof Error &&
      /^File (?:data was not valid base64|file is too large)\.$/.test(
        error.message
      )
        ? error.message
        : null;
    sendJson(res, safeValidationMessage ? 400 : 500, {
      error:
        safeValidationMessage ??
        "Saving that file failed. Nothing was saved."
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
  if (!dir) {
    sendJson(res, 400, { error: "Invalid application id." });
    return;
  }
  // Only a name this module would itself have written can address a file.
  const safe = safeAttachmentFileName(rawFileName);
  if (!safe || safe.fileName !== rawFileName) {
    sendJson(res, 404, { error: "Attachment not found." });
    return;
  }
  const filePath = join(dir, safe.fileName);

  if (req.method === "DELETE") {
    try {
      const body = JSON.parse(
        await readBody(req, 20_000)
      ) as Record<string, unknown>;
      const result = await withApplicationsLock(async () => {
        const tracked = await readApplications(workspaceDir);
        const current = requireApplicationRevision(
          tracked,
          id,
          body.baseUpdatedAt
        );
        assertApplicationAcceptsDocuments(current);
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
          const applications = await writeApplications(
            workspaceDir,
            nextApplications
          );
          return {
            fileName: safe.fileName,
            deleted: true,
            application: applications.find(
              (application) => application.id === id
            ),
            applications
          };
        } catch (error) {
          await restoreApplicationFile(
            dir,
            safe.fileName,
            previousBytes
          ).catch(() => undefined);
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
          ...(error.status === 409 &&
          Array.isArray(error.currentApplications)
            ? { applications: error.currentApplications }
            : {})
        });
        return;
      }
      sendJson(res, 500, {
        error: "Removing that file failed. Nothing was changed."
      });
    }
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Use GET or DELETE." });
    return;
  }

  try {
    const data = await withApplicationsLock(async () => {
      const applications = await readApplications(workspaceDir);
      const application = applications.find(
        (candidate) => candidate.id === id
      );
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
      // User-supplied files on the app origin are downloads, never markup.
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
