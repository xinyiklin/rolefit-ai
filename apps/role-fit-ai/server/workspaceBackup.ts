import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, join } from "node:path";
import {
  MAX_WORKSPACE_BACKUP_FILE_BYTES,
  MAX_WORKSPACE_BACKUP_BYTES,
  MAX_WORKSPACE_BACKUP_FILES,
  MAX_WORKSPACE_BACKUP_JSON_BYTES,
  WORKSPACE_BACKUP_FORMAT,
  WORKSPACE_BACKUP_SCHEMA_VERSION,
  isManagedWorkspaceBackupPath,
  parseWorkspaceBackupEnvelope,
  workspaceBackupEncodingForPath,
  type WorkspaceBackupEnvelope,
  type WorkspaceBackupFile
} from "../src/lib/workspaceBackupContract.ts";
import { readBody } from "./http.ts";
import { readApplications, withApplicationsLock } from "./applications/index.ts";
import { ensureJobWorkspace, validateBaseResumeText, withWorkspaceLock } from "./workspace.ts";
import {
  readStoredBrowserPreferences,
  writeStoredBrowserPreferences,
  writeWorkspaceRestoreMarker
} from "./browserPreferences.ts";
import { countActiveTabs } from "./presence.ts";

const ROOT_BASE_RESUME_RE = /^base-resume(?:-[A-Za-z0-9][A-Za-z0-9_-]*)?\.resume$/;
const LEGACY_BASE_RESUME_RE = /^base-resume\.(?:txt|md|csv)$/;
const HISTORY_FILE_RE = /^[A-Za-z0-9T-]+Z__base-resume(?:-[A-Za-z0-9][A-Za-z0-9_-]*)?\.(?:resume|txt|md|csv)$/;
const APPLICATION_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export class WorkspaceBackupError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "WorkspaceBackupError";
    this.status = status;
  }
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function checksum(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function backupStamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function assertWorkspaceBackupCapacity(fileCount: number, totalBytes: number): void {
  if (fileCount > MAX_WORKSPACE_BACKUP_FILES) {
    throw new WorkspaceBackupError("The workspace contains too many managed files to back up safely.", 413);
  }
  if (totalBytes > MAX_WORKSPACE_BACKUP_BYTES) {
    throw new WorkspaceBackupError("The workspace backup is larger than the supported 64 MB limit.", 413);
  }
}

async function safeEntries(directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
}

async function managedWorkspacePaths(workspaceDir: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await safeEntries(workspaceDir)) {
    if (!entry.isFile()) continue;
    if (entry.name === "applications.json" || ROOT_BASE_RESUME_RE.test(entry.name) || LEGACY_BASE_RESUME_RE.test(entry.name)) {
      paths.push(entry.name);
    }
  }
  for (const entry of await safeEntries(join(workspaceDir, ".trash"))) {
    if (entry.isFile() && HISTORY_FILE_RE.test(entry.name)) paths.push(`.trash/${entry.name}`);
  }
  for (const application of await safeEntries(join(workspaceDir, "applications"))) {
    if (!application.isDirectory() || !APPLICATION_ID_RE.test(application.name)) continue;
    const pdf = (await safeEntries(join(workspaceDir, "applications", application.name)))
      .find((entry) => entry.name === "resume.pdf" && entry.isFile());
    if (pdf) paths.push(`applications/${application.name}/resume.pdf`);
  }
  return paths.sort((a, b) => a.localeCompare(b));
}

function validatePdf(data: Buffer): void {
  if (data.length < 5 || data.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new WorkspaceBackupError("A saved application PDF is invalid. Repair or remove it before backing up.", 500);
  }
}

async function readManagedFile(
  workspaceDir: string,
  path: string,
  remainingBytes: number
): Promise<WorkspaceBackupFile> {
  if (!isManagedWorkspaceBackupPath(path)) throw new WorkspaceBackupError("The workspace contains an unsupported managed path.", 500);
  const filePath = join(workspaceDir, ...path.split("/"));
  const details = await stat(filePath);
  if (!details.isFile() || details.size > MAX_WORKSPACE_BACKUP_FILE_BYTES) {
    throw new WorkspaceBackupError(`The managed workspace file ${path} is too large to back up safely.`, 413);
  }
  if (details.size > remainingBytes) {
    throw new WorkspaceBackupError("The workspace backup is larger than the supported 64 MB limit.", 413);
  }
  const data = await readFile(filePath);
  if (data.byteLength > MAX_WORKSPACE_BACKUP_FILE_BYTES || data.byteLength > remainingBytes) {
    throw new WorkspaceBackupError("The workspace backup is larger than the supported 64 MB limit.", 413);
  }
  if (path === "applications.json") {
    await readApplications(workspaceDir);
  } else if (path.endsWith(".pdf")) {
    validatePdf(data);
  } else {
    validateBaseResumeText(basename(path), data);
  }
  const encoding = workspaceBackupEncodingForPath(path);
  return {
    path,
    encoding,
    byteLength: data.byteLength,
    sha256: checksum(data),
    data: data.toString(encoding === "base64" ? "base64" : "utf8")
  };
}

export async function createWorkspaceBackup(workspaceDir: string, now = new Date()): Promise<WorkspaceBackupEnvelope> {
  return withWorkspaceLock(() => withApplicationsLock(async () => {
    await ensureJobWorkspace(workspaceDir);
    const paths = await managedWorkspacePaths(workspaceDir);
    assertWorkspaceBackupCapacity(paths.length, 0);
    const files: WorkspaceBackupFile[] = [];
    let totalBytes = 0;
    for (const path of paths) {
      const file = await readManagedFile(workspaceDir, path, MAX_WORKSPACE_BACKUP_BYTES - totalBytes);
      totalBytes += file.byteLength;
      assertWorkspaceBackupCapacity(files.length + 1, totalBytes);
      files.push(file);
    }
    const envelope: WorkspaceBackupEnvelope = {
      format: WORKSPACE_BACKUP_FORMAT,
      schemaVersion: WORKSPACE_BACKUP_SCHEMA_VERSION,
      createdAt: now.toISOString(),
      files
    };
    // Include the workspace-resident browser-preferences mirror when present and
    // valid. The mirror file itself is deliberately outside the managed-path
    // allowlist, so it never appears in `files`. A missing OR corrupt mirror must
    // never block backing up resumes: omit `browser` and continue rather than
    // failing the backup.
    const stored = await readStoredBrowserPreferences(workspaceDir);
    if (stored.status === "ok") {
      envelope.browser = { settings: stored.value.settings, lastBaseResume: stored.value.lastBaseResume };
    }
    // Run the same aggregate file-count/size contract used at restore time.
    return parseWorkspaceBackupEnvelope(envelope);
  }));
}

function decodeBackupFile(file: WorkspaceBackupFile): Buffer {
  let data: Buffer;
  if (file.encoding === "base64") {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)) {
      throw new WorkspaceBackupError("The backup contains invalid base64 file data.");
    }
    data = Buffer.from(file.data, "base64");
  } else {
    data = Buffer.from(file.data, "utf8");
  }
  if (data.byteLength !== file.byteLength || checksum(data) !== file.sha256) {
    throw new WorkspaceBackupError("The backup failed its file integrity check.");
  }
  return data;
}

async function writeStagedBackup(stageDir: string, envelope: WorkspaceBackupEnvelope): Promise<void> {
  await mkdir(stageDir, { recursive: true, mode: 0o700 });
  for (const file of envelope.files) {
    const data = decodeBackupFile(file);
    const destination = join(stageDir, ...file.path.split("/"));
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, data, { mode: 0o600, flag: "wx" });
  }

  // Re-run domain validators against the complete staged tree. Nothing in the
  // active workspace has changed at this point.
  if (envelope.files.some((file) => file.path === "applications.json")) {
    try {
      await readApplications(stageDir);
    } catch {
      throw new WorkspaceBackupError("The backup's application tracker data is invalid.");
    }
  }
  for (const file of envelope.files) {
    const data = await readFile(join(stageDir, ...file.path.split("/")));
    if (file.path.endsWith(".pdf")) {
      try {
        validatePdf(data);
      } catch {
        throw new WorkspaceBackupError("The backup contains an invalid saved application PDF.");
      }
    } else if (file.path !== "applications.json") {
      try {
        validateBaseResumeText(basename(file.path), data);
      } catch {
        throw new WorkspaceBackupError("The backup contains an invalid base-resume file.");
      }
    }
  }
}

export async function restoreWorkspaceBackup(
  workspaceDir: string,
  input: unknown,
  now = new Date(),
  // Live Drafting Desk tab count. The companion cannot see browser tabs, so the
  // presence beacon feeds this; a restore refuses while any tab is live. Defaults
  // to zero so direct callers (evals) opt in explicitly and stay simple.
  activeTabs: number | (() => number) = countActiveTabs
): Promise<{ restoredFiles: number; previousWorkspaceKept: boolean }> {
  let envelope: WorkspaceBackupEnvelope;
  try {
    envelope = parseWorkspaceBackupEnvelope(input);
  } catch (error) {
    throw new WorkspaceBackupError(error instanceof Error ? error.message : "This workspace backup is invalid.");
  }

  return withWorkspaceLock(() => withApplicationsLock(async () => {
    const currentActiveTabs = (): number => typeof activeTabs === "function" ? activeTabs() : activeTabs;
    // Presence gate: refuse to replace the workspace under a live browser tab so
    // an open Drafting Desk session cannot save over the just-restored files.
    if (currentActiveTabs() > 0) {
      throw new WorkspaceBackupError(
        "Close RoleFit browser tabs before restoring, or wait a few seconds after closing them.",
        409
      );
    }
    const parent = dirname(workspaceDir);
    const leaf = basename(workspaceDir);
    if (!leaf || leaf === "." || leaf === "..") throw new WorkspaceBackupError("The active workspace path is invalid.", 500);
    await mkdir(parent, { recursive: true });
    const nonce = randomUUID();
    const stageDir = join(parent, `.${leaf}.restore-incoming-${nonce}`);
    const previousDir = join(parent, `${leaf}.restore-backup-${backupStamp(now)}-${nonce.slice(0, 8)}`);
    let previousWorkspaceKept = false;
    try {
      await writeStagedBackup(stageDir, envelope);
      // Every restore gets a generation marker, even when the backup has no
      // optional browser preferences. The browser uses it to clear recovery
      // drafts from the pre-restore workspace without inventing preferences.
      await writeWorkspaceRestoreMarker(stageDir, now);
      // Stage optional browser preferences alongside the restored files.
      if (envelope.browser) {
        await writeStoredBrowserPreferences(stageDir, envelope.browser, "restore", now);
      }
      // Staging can take long enough for a browser tab to open after the first
      // gate. Recheck at the replacement boundary while the active workspace is
      // still untouched.
      if (currentActiveTabs() > 0) {
        throw new WorkspaceBackupError(
          "Close RoleFit browser tabs before restoring, or wait a few seconds after closing them.",
          409
        );
      }
      try {
        await rename(workspaceDir, previousDir);
        previousWorkspaceKept = true;
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
      try {
        await rename(stageDir, workspaceDir);
      } catch (error) {
        if (previousWorkspaceKept) {
          try {
            await rename(previousDir, workspaceDir);
          } catch {
            throw new WorkspaceBackupError(
              "Restore could not complete and the previous workspace could not return to the active path. It remains in the local restore-backup safety directory.",
              500
            );
          }
        }
        throw error;
      }
      return { restoredFiles: envelope.files.length, previousWorkspaceKept };
    } catch (error) {
      if (error instanceof WorkspaceBackupError) throw error;
      throw new WorkspaceBackupError("The workspace could not be restored safely. The current workspace was kept.", 500);
    } finally {
      await rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }));
}

function sendBackupJson(res: ServerResponse, status: number, payload: unknown, fileName?: string): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/vnd.rolefit.workspace-backup+json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body, "utf8"),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...(fileName ? { "Content-Disposition": `attachment; filename="${fileName}"` } : {})
  });
  res.end(body);
}

export async function handleWorkspaceBackup(req: IncomingMessage, res: ServerResponse, workspaceDir: string): Promise<void> {
  if (req.method !== "GET") {
    sendBackupJson(res, 405, { error: "Use GET." });
    return;
  }
  try {
    const backup = await createWorkspaceBackup(workspaceDir);
    sendBackupJson(res, 200, backup, `RoleFit-Workspace-${backup.createdAt.slice(0, 10)}.rolefit-backup`);
  } catch (error) {
    const status = error instanceof WorkspaceBackupError ? error.status : 500;
    sendBackupJson(res, status, {
      error: error instanceof WorkspaceBackupError ? error.message : "The workspace could not be backed up safely."
    });
  }
}

export async function handleWorkspaceRestore(req: IncomingMessage, res: ServerResponse, workspaceDir: string): Promise<void> {
  if (req.method !== "POST") {
    sendBackupJson(res, 405, { error: "Use POST." });
    return;
  }
  try {
    const raw = await readBody(req, MAX_WORKSPACE_BACKUP_JSON_BYTES);
    const input = JSON.parse(raw) as unknown;
    const result = await restoreWorkspaceBackup(workspaceDir, input, new Date(), countActiveTabs);
    sendBackupJson(res, 200, { restored: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const tooLarge = message === "Request is too large.";
    const status = tooLarge ? 413 : error instanceof WorkspaceBackupError ? error.status : 400;
    sendBackupJson(res, status, {
      error: tooLarge
        ? "The workspace backup is larger than the supported upload limit."
        : error instanceof WorkspaceBackupError
          ? error.message
          : "This is not a valid RoleFit workspace backup."
    });
  }
}
