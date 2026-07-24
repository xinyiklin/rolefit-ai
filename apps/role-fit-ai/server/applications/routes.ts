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

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody, sendJson } from "../http.ts";
import { base64ToBuffer } from "../base64.ts";
import { jobWorkspaceDir } from "../workspace.ts";
import { WorkspaceRestoreConflictError } from "../workspaceRestoreGate.ts";
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

function applicationResumeDir(id: string, workspaceDir: string): string | null {
  if (!APPLICATION_ID_RE.test(id)) return null;
  const dir = join(workspaceDir, "applications", id);
  // Defense in depth: ensure the resolved path stays inside the workspace.
  const base = resolve(workspaceDir, "applications");
  if (!resolve(dir).startsWith(base + sep) && resolve(dir) !== base) return null;
  return dir;
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

// Persist a tailored resume's compiled PDF for one application under
// job-search-workspace/applications/<id>/ (gitignored). The returned
// resumeArtifacts mirrors the shape the application sanitizer stores.
export async function handleSaveApplicationResume(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  workspaceDir = jobWorkspaceDir
): Promise<void> {
  if (req.method !== "POST") { sendJson(res, 405, { error: "Use POST." }); return; }
  const dir = applicationResumeDir(id, workspaceDir);
  if (!dir) { sendJson(res, 400, { error: "Invalid application id." }); return; }
  try {
    // Transport cap sized for the base64 envelope of the 8 MB decoded PDF cap
    // below (4/3 inflation + JSON overhead) — with the default 8 MB readBody
    // cap the decoded 413 branch could never be reached.
    const body = JSON.parse(await readBody(req, 11_500_000));
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
    const hasPdf = await withApplicationsLock(async () => {
      await mkdir(dir, { recursive: true });
      if (!pdfBuffer) return false;
      const filePath = join(dir, "resume.pdf");
      const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, pdfBuffer, { mode: 0o600 });
        await rename(temporaryPath, filePath);
      } finally {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
      }
      return true;
    });
    sendJson(res, 200, {
      resumeArtifacts: { hasPdf, fileName, savedAt: new Date().toISOString() }
    });
  } catch (error) {
    if (restoreConflictHandled(error, res)) return;
    if (error instanceof Error && error.message === "Request is too large.") {
      sendJson(res, 413, { error: "The resume PDF is larger than the supported limit. No file was replaced." });
      return;
    }
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
export async function handleApplicationResumeFile(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  workspaceDir = jobWorkspaceDir
): Promise<void> {
  if (req.method !== "GET") { sendJson(res, 405, { error: "Use GET." }); return; }
  const dir = applicationResumeDir(id, workspaceDir);
  if (!dir) { sendJson(res, 400, { error: "Invalid application id." }); return; }
  const filePath = join(dir, "resume.pdf");
  try {
    const data = await withApplicationsLock(() => readFile(filePath));
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
