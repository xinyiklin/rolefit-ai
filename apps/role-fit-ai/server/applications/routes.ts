// Application tracker HTTP routes: list/save/delete tracked applications and
// persist/stream a tailored resume's saved .pdf artifact. Split out of
// server.ts; the read-modify-write handlers are serialized through a
// process-local promise lock (withApplicationsLock) that guards
// applications.json against overlapping cycles.
//
// jobWorkspaceDir is imported from ../workspace.ts (the single source of truth
// for the workspace directory) rather than injected via a factory; the module
// state (the write queue) is module-level because the server instantiates these
// routes exactly once. Everything else (JSON I/O, base64 decode, HTTP helpers) is
// imported directly, matching the server/ai/* module style.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody, sendJson } from "../http.ts";
import { base64ToBuffer } from "../base64.ts";
import { jobWorkspaceDir } from "../workspace.ts";
import {
  APPLICATION_ID_RE,
  ApplicationsStorageError,
  applicationsFilePath,
  readApplications,
  reconcileApplicationMutations,
  sanitizeApplications,
  writeApplications
} from "./index.ts";

function storageErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApplicationsStorageError ? error.message : fallback;
}

function applicationResumeDir(id: string): string | null {
  if (!APPLICATION_ID_RE.test(id)) return null;
  const dir = join(jobWorkspaceDir, "applications", id);
  // Defense in depth: ensure the resolved path stays inside the workspace.
  const base = resolve(jobWorkspaceDir, "applications");
  if (!resolve(dir).startsWith(base + sep) && resolve(dir) !== base) return null;
  return dir;
}

export async function handleListApplications(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const applications = await readApplications(jobWorkspaceDir);
    sendJson(res, 200, {
      applications,
      path: applicationsFilePath(jobWorkspaceDir)
    });
  } catch (error) {
    sendJson(res, 500, { error: storageErrorMessage(error, "Application list failed.") });
  }
}

// Serialize applications.json read-modify-write cycles. The merge/delete
// handlers each read the file, derive a new list, and write it back; two
// overlapping requests (e.g. Apply clicked in two tabs at once) could both read
// the same disk state and the second write would drop the first's entry. A
// simple promise chain makes each cycle atomic within this process — sufficient
// for the single-server local app.
let applicationsWriteQueue: Promise<unknown> = Promise.resolve();
function withApplicationsLock<T>(task: () => Promise<T>): Promise<T> {
  const run = applicationsWriteQueue.then(task);
  applicationsWriteQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export async function handleSaveApplications(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
      const existing = await readApplications(jobWorkspaceDir);
      const reconciled = reconcileApplicationMutations(existing, incoming, body.mutations);
      return writeApplications(jobWorkspaceDir, reconciled);
    });
    sendJson(res, 200, { applications });
  } catch (error) {
    const status = error instanceof ApplicationsStorageError ? error.status : 400;
    sendJson(res, status, {
      error: storageErrorMessage(error, "Application save failed. Check the request and try again."),
      ...(status === 409 && error instanceof ApplicationsStorageError && Array.isArray(error.currentApplications)
        ? { applications: error.currentApplications }
        : {})
    });
  }
}

export async function handleDeleteApplication(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
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
      const existing = await readApplications(jobWorkspaceDir);
      const current = existing.find((application) => application.id === id);
      if (!current) return null;
      const filtered = existing.filter((application) => application.id !== id);
      const reconciled = reconcileApplicationMutations(existing, filtered, [
        { id, operation: "delete", baseUpdatedAt: baseUpdatedAt.trim() }
      ]);
      return writeApplications(jobWorkspaceDir, reconciled);
    });
    if (applications === null) {
      sendJson(res, 404, { error: "Application not found." });
      return;
    }
    sendJson(res, 200, { applications });
  } catch (error) {
    const status = error instanceof ApplicationsStorageError ? error.status : 400;
    sendJson(res, status, {
      error: storageErrorMessage(error, "Delete failed."),
      ...(status === 409 && error instanceof ApplicationsStorageError && Array.isArray(error.currentApplications)
        ? { applications: error.currentApplications }
        : {})
    });
  }
}

// Persist a tailored resume's compiled PDF for one application under
// job-search-workspace/applications/<id>/ (gitignored). The returned
// resumeArtifacts mirrors the shape the application sanitizer stores.
export async function handleSaveApplicationResume(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  if (req.method !== "POST") { sendJson(res, 405, { error: "Use POST." }); return; }
  const dir = applicationResumeDir(id);
  if (!dir) { sendJson(res, 400, { error: "Invalid application id." }); return; }
  try {
    const body = JSON.parse(await readBody(req));
    const pdfBase64 = typeof body.pdfBase64 === "string" ? body.pdfBase64 : "";
    const fileName = typeof body.fileName === "string" ? body.fileName.slice(0, 200) : "";
    if (!pdfBase64) { sendJson(res, 400, { error: "No resume artifacts to save." }); return; }
    // Size cap: pdf ~8MB decoded.
    let pdfBuffer: Buffer | null = null;
    if (pdfBase64) {
      pdfBuffer = base64ToBuffer(pdfBase64, "PDF");
      if (pdfBuffer.length > 8_000_000) { sendJson(res, 413, { error: "PDF too large." }); return; }
      if (pdfBuffer.length < 5 || pdfBuffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
        sendJson(res, 400, { error: "PDF data was not a valid PDF file." });
        return;
      }
    }
    await mkdir(dir, { recursive: true });
    let hasPdf = false;
    if (pdfBuffer) {
      const filePath = join(dir, "resume.pdf");
      const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, pdfBuffer, { mode: 0o600 });
        await rename(temporaryPath, filePath);
      } finally {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
      }
      hasPdf = true;
    }
    sendJson(res, 200, {
      resumeArtifacts: { hasPdf, fileName, savedAt: new Date().toISOString() }
    });
  } catch (error) {
    const safeValidationMessage = error instanceof Error && /^PDF (?:data was not valid base64|file is too large)\.$/.test(error.message)
      ? error.message
      : null;
    sendJson(res, safeValidationMessage ? 400 : 500, {
      error: safeValidationMessage ?? "Saving the resume artifact failed. No file was replaced."
    });
  }
}

// Stream a saved resume PDF back as a file download. The browser names it via
// the <a download> attribute; the Content-Disposition filename is only a
// fallback, so a fixed "resume" name is fine here.
export async function handleApplicationResumeFile(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  if (req.method !== "GET") { sendJson(res, 405, { error: "Use GET." }); return; }
  const dir = applicationResumeDir(id);
  if (!dir) { sendJson(res, 400, { error: "Invalid application id." }); return; }
  const filePath = join(dir, "resume.pdf");
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="resume.pdf"`,
      "Content-Length": data.length,
      "Cache-Control": "no-store"
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: "Resume artifact not found." });
  }
}
