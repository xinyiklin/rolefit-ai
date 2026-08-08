// Resume imports and starter fallback stay separate from strict cover-letter
// storage; embedded runtimes pass explicit app and workspace roots.

import type { IncomingMessage, ServerResponse } from "node:http";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { parseResumeFile } from "@typeset/engine/lib/resumeFile.ts";
import { readBody, sendJson } from "./http.ts";
import { WorkspaceRestoreConflictError, assertWorkspaceAccessAllowed, captureWorkspaceAccess } from "./workspaceRestoreGate.ts";
import { readCoverLetterWorkspace } from "./coverLetterWorkspace.ts";

// A loaded base resume (or the "none found" sentinel). Optional fields carry the
// file's text/metadata only when a resume was actually resolved.
type BaseResumeResult = {
  exists: boolean;
  fileName?: string;
  label?: string;
  kind?: string;
  text?: string;
  paragraphs?: number;
};

export type WorkspaceLocations = {
  appRoot: string;
  workspaceDir: string;
};

const defaultAppRoot = process.cwd();
export const jobWorkspaceDir = join(defaultAppRoot, "workspace");
const defaultWorkspaceLocations: WorkspaceLocations = {
  appRoot: defaultAppRoot,
  workspaceDir: jobWorkspaceDir
};
const baseResumeCandidates = [
  "default.resume",
  "default.txt",
  "default.md",
  "default.csv"
];
const baseResumeVariantPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*\.resume$/;
const MAX_BASE_RESUME_BYTES = 200_000;
// A batch read is a convenience over one lock, not an unbounded workspace dump.
const MAX_BASE_RESUME_CANDIDATES = 40;

export class WorkspaceStorageError extends Error {
  constructor(message = "The base-resume workspace could not be read safely. Check the workspace files and try again.") {
    super(message);
    this.name = "WorkspaceStorageError";
  }
}

export function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

// Serialize reads with mutations as well as mutation-to-mutation cycles. A save
// archives the current file before atomically installing its replacement; a read
// in that short interval must not mistake the workspace for an empty fresh install.
let workspaceQueue: Promise<unknown> = Promise.resolve();
export function withWorkspaceLock<T>(
  task: () => Promise<T>,
  options: { allowDuringRestore?: boolean } = {}
): Promise<T> {
  const capture = captureWorkspaceAccess();
  const run = workspaceQueue.then(() => {
    if (!options.allowDuringRestore) assertWorkspaceAccessAllowed(capture);
    return task();
  });
  workspaceQueue = run.then(() => undefined, () => undefined);
  return run;
}

// A queued route task rejected by the restore gate carries a designed 409 plus
// reload guidance; forward it instead of the route's generic failure mapping
// (which would report a malformed request or a broken server).
export function restoreConflictHandled(error: unknown, res: ServerResponse): boolean {
  if (!(error instanceof WorkspaceRestoreConflictError)) return false;
  sendJson(res, 409, { error: error.message });
  return true;
}

let lastTrashStampMs = 0;
export function nextTrashStamp(): string {
  const now = Math.max(Date.now(), lastTrashStampMs + 1);
  lastTrashStampMs = now;
  return new Date(now).toISOString().replace(/[:.]/g, "-");
}

export function validateBaseResumeText(fileName: string, data: Buffer): string {
  if (data.byteLength > MAX_BASE_RESUME_BYTES) {
    throw new WorkspaceStorageError("The base resume is too large to read safely.");
  }
  const text = data.toString("utf8");
  if (text.trim().length < 80) throw new WorkspaceStorageError("The base resume is empty or too short to load.");
  if (extname(fileName).toLowerCase() === ".resume") {
    try {
      parseResumeFile(text);
    } catch {
      throw new WorkspaceStorageError("The saved .resume file is invalid. Restore a valid version from history before continuing.");
    }
  }
  return text;
}

export async function atomicWriteWorkspaceFile(filePath: string, data: string | Buffer): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, data, { mode: 0o600 });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function ensureJobWorkspace(workspaceDir = jobWorkspaceDir): Promise<void> {
  await Promise.all([
    mkdir(workspaceDir, { recursive: true }),
    mkdir(join(workspaceDir, "resumes"), { recursive: true }),
    mkdir(join(workspaceDir, "cover-letters"), { recursive: true })
  ]);
}

export const resumeWorkspaceDir = (locations: WorkspaceLocations): string =>
  join(locations.workspaceDir, "resumes");
export const coverLetterWorkspaceDir = (locations: WorkspaceLocations): string =>
  join(locations.workspaceDir, "cover-letters");

export async function readWorkspaceFiles(locations: WorkspaceLocations): Promise<string[]> {
  try {
    const entries = await readdir(locations.workspaceDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => name !== ".DS_Store")
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw new WorkspaceStorageError();
  }
}

function assertBaseResumeFileName(fileName: unknown): string {
  const name = String(fileName ?? "").trim();
  if (!baseResumeVariantPattern.test(name) || name.includes("/") || name.includes("..")) {
    throw new Error("Choose a valid base resume version.");
  }
  return name;
}

function assertRemovableBaseResumeFileName(fileName: unknown): string {
  const name = String(fileName ?? "").trim();
  return baseResumeCandidates.includes(name)
    ? name
    : assertBaseResumeFileName(name);
}

function baseResumeLabel(fileName: string): string {
  const base = fileName.replace(/\.(resume|txt|md|csv)$/i, "");
  if (base === "default") return "Default";
  const friendlyWords = new Map([
    ["ai", "AI"],
    ["api", "API"],
    ["ats", "ATS"],
    ["fde", "FDE"],
    ["llm", "LLM"],
    ["sde", "SDE"],
    ["swe", "SWE"],
    ["ui", "UI"],
    ["ux", "UX"]
  ]);
  return base
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => friendlyWords.get(part.toLowerCase()) ?? part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export async function readWorkspaceBaseResume(
  requestedFileName?: string,
  locations: WorkspaceLocations = defaultWorkspaceLocations
): Promise<BaseResumeResult> {
  const candidates = requestedFileName
    ? [assertBaseResumeFileName(requestedFileName)]
    : [
        ...(await readBaseResumeOptions(locations)).map((option) => option.fileName),
        ...baseResumeCandidates.filter((name) => !baseResumeVariantPattern.test(name))
      ];

  const uniqueCandidates = [...new Set(candidates)];
  for (const fileName of uniqueCandidates) {
    const filePath = join(resumeWorkspaceDir(locations), fileName);
    try {
      const data = await readFile(filePath);
      // Never truncate a structured file: validate the complete bytes before
      // exposing it to the client, which otherwise receives corrupt JSON.
      const text = validateBaseResumeText(fileName, data);
      return {
        exists: true,
        fileName,
        label: baseResumeLabel(fileName),
        kind: extname(fileName).toLowerCase().replace(".", "") || "text",
        text
      };
    } catch (error) {
      if (isMissingFile(error)) continue;
      if (error instanceof WorkspaceStorageError) throw error;
      throw new WorkspaceStorageError();
    }
  }

  // An explicit version selection never falls through to the starter template.
  if (requestedFileName) return { exists: false };

  // No workspace file found — fall back to the bundled starter .resume so the
  // editor is never empty on a fresh install.
  return readBundledStarterResume(locations);
}

async function readBundledStarterResume(
  locations: WorkspaceLocations
): Promise<BaseResumeResult> {
  try {
    const starterPath = join(locations.appRoot, "server/starter.resume");
    const starterText = await readFile(starterPath, "utf8");
    return { exists: false, text: starterText, kind: "resume", fileName: "starter.resume" };
  } catch {
    return { exists: false };
  }
}

async function readBaseResumeOptions(locations: WorkspaceLocations): Promise<{ fileName: string; label: string; kind: string }[]> {
  const files = await readdir(resumeWorkspaceDir(locations)).catch((error) => {
    if (isMissingFile(error)) return [] as string[];
    throw error;
  });
  return files
    .filter((name) => baseResumeVariantPattern.test(name))
    .map((fileName) => ({
      fileName,
      label: baseResumeLabel(fileName),
      kind: "resume"
    }))
    .sort((a, b) => {
      if (a.fileName === "default.resume") return -1;
      if (b.fileName === "default.resume") return 1;
      return a.label.localeCompare(b.label);
    });
}

// Clear the app-managed default base resume, but never hard-delete: move every
// known default format into the active workspace's .trash/ directory with a
// timestamp so a removed or replaced base resume is always recoverable. Named
// variants such as fullstack.resume stay in place.
async function clearBaseResumeFiles(locations: WorkspaceLocations): Promise<void> {
  const trashDir = join(resumeWorkspaceDir(locations), ".trash");
  await mkdir(trashDir, { recursive: true });
  const stamp = nextTrashStamp();
  await Promise.all(
    baseResumeCandidates.map(async (name) => {
      try {
        await rename(join(resumeWorkspaceDir(locations), name), join(trashDir, `${stamp}__${name}`));
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
      }
    })
  );
}

// Back up a single base-resume file (including named variants) to .trash/.
async function trashBaseFile(name: string, locations: WorkspaceLocations): Promise<void> {
  const trashDir = join(resumeWorkspaceDir(locations), ".trash");
  await mkdir(trashDir, { recursive: true });
  const stamp = nextTrashStamp();
  try {
    await rename(join(resumeWorkspaceDir(locations), name), join(trashDir, `${stamp}__${name}`));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }
}

// One parsed .trash/ filename (stamp + variant stem + extension), and the grouped
// history shapes the UI consumes.
type HistoryMatch = { fileName: string; stem: string; originalName: string; kind: string; stamp: string; date: Date };
type HistoryEntry = { key: string; originalName: string; kind: string; date: string };
type HistoryGroup = { variant: string; label: string; entries: HistoryEntry[] };

// List the most recent base-resume versions from .trash/, grouped by variant so
// the UI can show one expandable group per variant. Each group keeps only the
// `perVariant` most recent entries (default 3); older backups stay in .trash and
// remain restorable by hand — this is a display cap, not a destructive prune.
// The variant identity is the file stem (extension-agnostic) so a Default whose
// history spans default.resume and default.txt consolidates into one group.
// Matches both default.resume and named variants such as fullstack.resume.
async function readBaseResumeHistory(locations: WorkspaceLocations, perVariant = 3): Promise<HistoryGroup[]> {
  const trashDir = join(resumeWorkspaceDir(locations), ".trash");
  let entries: string[];
  try {
    entries = await readdir(trashDir);
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw new WorkspaceStorageError();
  }
  // Matches: 2026-06-10T16-30-45-123Z__base-resume[-variant].(resume|txt|md|csv)
  const baseResumePattern = /^(.+?)__([A-Za-z0-9][A-Za-z0-9_-]*)\.(resume|txt|md|csv)$/;
  const matched = (entries
    .map((name): HistoryMatch | null => {
      const m = name.match(baseResumePattern);
      if (!m) return null;
      const stem = m[2]; // e.g. "default" or "frontend"
      const originalName = `${stem}.${m[3]}`;
      // Reconstruct a rough ISO date for display; the raw stamp is authoritative.
      const date = new Date(m[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, "T$1:$2:$3.$4Z"));
      return { fileName: name, stem, originalName, kind: m[3], stamp: m[1], date };
    })
    .filter(Boolean) as HistoryMatch[])
    .sort((a, b) => b.stamp.localeCompare(a.stamp));

  // Group newest-first by variant stem, then cap each group to `perVariant`.
  const groups = new Map<string, HistoryGroup>();
  for (const entry of matched) {
    let group = groups.get(entry.stem);
    if (!group) {
      group = { variant: entry.stem, label: baseResumeLabel(entry.originalName), entries: [] };
      groups.set(entry.stem, group);
    }
    if (group.entries.length >= perVariant) continue;
    group.entries.push({
      key: entry.fileName,
      originalName: entry.originalName,
      kind: entry.kind,
      date: isNaN(entry.date.getTime()) ? entry.stamp : entry.date.toISOString()
    });
  }

  // Default variant first, then alphabetical by label — mirrors readBaseResumeOptions.
  return [...groups.values()].sort((a, b) => {
    if (a.variant === "default") return -1;
    if (b.variant === "default") return 1;
    return a.label.localeCompare(b.label);
  });
}

async function workspaceSnapshot(locations: WorkspaceLocations, baseResume?: BaseResumeResult) {
  // Cover-letter state rides along so one GET /api/workspace seeds both editors
  // and every mutation returns a snapshot that is current for both.
  const coverLetter = await readCoverLetterWorkspace(locations);
  return {
    path: locations.workspaceDir,
    ...coverLetter,
    baseResume: baseResume ?? await readWorkspaceBaseResume(undefined, locations),
    starterResume: await readBundledStarterResume(locations),
    baseResumeOptions: await readBaseResumeOptions(locations),
    baseResumeHistory: await readBaseResumeHistory(locations),
    files: await readWorkspaceFiles(locations)
  };
}

export async function handleWorkspace(
  req: IncomingMessage,
  res: ServerResponse,
  locations: WorkspaceLocations = defaultWorkspaceLocations
): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Use GET." });
    return;
  }

  try {
    const snapshot = await withWorkspaceLock(async () => {
      await ensureJobWorkspace(locations.workspaceDir);
      return workspaceSnapshot(locations);
    });
    sendJson(res, 200, snapshot);
  } catch (error) {
    if (restoreConflictHandled(error, res)) return;
    sendJson(res, 500, {
      error: error instanceof WorkspaceStorageError ? error.message : "Workspace check failed."
    });
  }
}

export async function handleSelectBaseResume(
  req: IncomingMessage,
  res: ServerResponse,
  locations: WorkspaceLocations = defaultWorkspaceLocations
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  try {
    const body = JSON.parse(await readBody(req, 2_000));
    const fileName = assertBaseResumeFileName(body.fileName);
    const snapshot = await withWorkspaceLock(async () => {
      await ensureJobWorkspace(locations.workspaceDir);
      const baseResume = await readWorkspaceBaseResume(fileName, locations);
      return baseResume.exists ? workspaceSnapshot(locations, baseResume) : null;
    });
    if (!snapshot) {
      sendJson(res, 404, { error: "Base resume version not found." });
      return;
    }
    sendJson(res, 200, snapshot);
  } catch (error) {
    if (restoreConflictHandled(error, res)) return;
    sendJson(res, error instanceof WorkspaceStorageError ? 500 : 400, {
      error: error instanceof WorkspaceStorageError
        ? error.message
        : error instanceof Error ? error.message : "Base resume load failed."
    });
  }
}

// Ranking saved variants needs several resumes' bytes at once, before any
// provider request. The select route answers with a whole workspace snapshot
// (cover-letter state, starter, options, history, file list) and takes the
// workspace lock per call, so N variants cost N serialized snapshots on the
// critical path to the first AI result. This reads only the requested resumes,
// under one lock, and returns nothing else.
export async function handleBaseResumeCandidates(
  req: IncomingMessage,
  res: ServerResponse,
  locations: WorkspaceLocations = defaultWorkspaceLocations
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  try {
    const body = JSON.parse(await readBody(req, 8_000));
    const requested = Array.isArray(body.fileNames) ? body.fileNames : [];
    if (!requested.length) {
      sendJson(res, 400, { error: "List the base resume versions to read." });
      return;
    }
    if (requested.length > MAX_BASE_RESUME_CANDIDATES) {
      sendJson(res, 400, { error: "Too many base resume versions were requested at once." });
      return;
    }
    const fileNames: string[] = [];
    for (const requestedName of requested) {
      const fileName = assertBaseResumeFileName(requestedName);
      if (!fileNames.includes(fileName)) fileNames.push(fileName);
    }
    const candidates = await withWorkspaceLock(async () => {
      await ensureJobWorkspace(locations.workspaceDir);
      const read: { fileName: string; label: string; kind: string; text: string }[] = [];
      for (const fileName of fileNames) {
        // One unreadable or invalid variant must not fail the batch. The ranker
        // treats an incomplete candidate set as "no recommendation", which is
        // the honest outcome; a 500 would leave Prepare with no selection at all.
        try {
          const baseResume = await readWorkspaceBaseResume(fileName, locations);
          if (!baseResume.exists || !baseResume.text) continue;
          read.push({
            fileName,
            label: baseResume.label ?? baseResumeLabel(fileName),
            kind: baseResume.kind ?? "resume",
            text: baseResume.text
          });
        } catch (error) {
          if (error instanceof WorkspaceStorageError) continue;
          throw error;
        }
      }
      return read;
    });
    sendJson(res, 200, { candidates });
  } catch (error) {
    if (restoreConflictHandled(error, res)) return;
    sendJson(res, error instanceof WorkspaceStorageError ? 500 : 400, {
      error: error instanceof WorkspaceStorageError
        ? error.message
        : error instanceof Error ? error.message : "Base resume versions could not be read."
    });
  }
}

export async function handleWorkspaceBaseResume(
  req: IncomingMessage,
  res: ServerResponse,
  locations: WorkspaceLocations = defaultWorkspaceLocations
): Promise<void> {
  if (req.method === "DELETE") {
    try {
      const body = JSON.parse(await readBody(req, 1_000));
      const fileName = assertRemovableBaseResumeFileName(body.fileName);
      const snapshot = await withWorkspaceLock(async () => {
        await ensureJobWorkspace(locations.workspaceDir);
        try {
          await access(join(resumeWorkspaceDir(locations), fileName));
        } catch (error) {
          if (isMissingFile(error)) return null;
          throw error;
        }
        if (baseResumeCandidates.includes(fileName)) await clearBaseResumeFiles(locations);
        else await trashBaseFile(fileName, locations);
        return workspaceSnapshot(locations);
      });
      if (!snapshot) {
        sendJson(res, 404, { error: "Base resume not found." });
        return;
      }
      sendJson(res, 200, {
        removed: true,
        ...snapshot
      });
    } catch (error) {
      if (restoreConflictHandled(error, res)) return;
      sendJson(res, error instanceof WorkspaceStorageError ? 500 : 400, {
        error: error instanceof WorkspaceStorageError
          ? error.message
          : error instanceof Error ? error.message : "Base resume removal failed."
      });
    }
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST or DELETE." });
    return;
  }

  try {
    const body = JSON.parse(await readBody(req));
    const fileName = String(body.fileName ?? "").trim();
    const extension = extname(fileName).toLowerCase();

    if (![".txt", ".md", ".csv", ".resume", ""].includes(extension)) {
      sendJson(res, 400, { error: "Save a RESUME, TXT, MD, or CSV resume as the base resume." });
      return;
    }

    // Never silently slice a user's resume. Reject an oversized payload before
    // archiving the current version, and validate strict .resume JSON likewise.
    const isResume = extension === ".resume";
    const rawText = String(body.text ?? "");
    if (Buffer.byteLength(rawText, "utf8") > MAX_BASE_RESUME_BYTES) {
      sendJson(res, 413, { error: "Resume file is too large to save." });
      return;
    }
    const text = rawText;
    if (text.trim().length < 80) {
      sendJson(res, 400, { error: "Base resume text is too short to save." });
      return;
    }

    // Preserve managed workspace .resume variant names. Uploaded .resume names
    // that fail the guard normalize to default.resume.
    let targetName = "default.txt";
    if (isResume) {
      targetName = baseResumeVariantPattern.test(fileName) ? assertBaseResumeFileName(fileName) : "default.resume";
      try {
        parseResumeFile(text);
      } catch {
        sendJson(res, 400, { error: "Save a valid Typeset .resume file." });
        return;
      }
    }
    const snapshot = await withWorkspaceLock(async () => {
      await ensureJobWorkspace(locations.workspaceDir);
      if (targetName === "default.resume" || !isResume) {
        await clearBaseResumeFiles(locations);
      } else {
        // Named variant: back it up before overwriting so it appears in version history.
        await trashBaseFile(targetName, locations);
      }
      await atomicWriteWorkspaceFile(join(resumeWorkspaceDir(locations), targetName), text);
      return workspaceSnapshot(locations, {
        exists: true,
        fileName: targetName,
        label: baseResumeLabel(targetName),
        kind: isResume ? "resume" : "txt",
        text
      });
    });
    sendJson(res, 200, {
      saved: true,
      ...snapshot
    });
  } catch (error) {
    if (restoreConflictHandled(error, res)) return;
    sendJson(res, error instanceof WorkspaceStorageError ? 500 : 400, {
      error: error instanceof WorkspaceStorageError ? error.message : "Base resume save failed."
    });
  }
}

export async function handleRestoreBaseResume(
  req: IncomingMessage,
  res: ServerResponse,
  locations: WorkspaceLocations = defaultWorkspaceLocations
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }
  try {
    const body = JSON.parse(await readBody(req, 1_000));
    const key = String(body.key ?? "");
    if (!key || key.includes("/") || key.includes("..")) {
      sendJson(res, 400, { error: "Invalid history key." });
      return;
    }
    const trashDir = join(resumeWorkspaceDir(locations), ".trash");
    const sourcePath = join(trashDir, key);

    // Extract the original filename from the key (after the stamp prefix).
    const keyMatch = key.match(/^.+?__([A-Za-z0-9][A-Za-z0-9_-]*\.(?:resume|txt|md|csv))$/);
    if (!keyMatch) {
      sendJson(res, 400, { error: "Invalid history key." });
      return;
    }
    const targetName = keyMatch[1];
    const isNamedVariant = baseResumeVariantPattern.test(targetName) && targetName !== "default.resume";

    const snapshot = await withWorkspaceLock(async () => {
      await ensureJobWorkspace(locations.workspaceDir);
      // Validate the archived bytes before moving the current good version.
      const data = await readFile(sourcePath);
      validateBaseResumeText(targetName, data);
      if (isNamedVariant) {
        await trashBaseFile(targetName, locations);
      } else {
        await clearBaseResumeFiles(locations);
      }
      await atomicWriteWorkspaceFile(join(resumeWorkspaceDir(locations), targetName), data);
      return workspaceSnapshot(locations, await readWorkspaceBaseResume(targetName, locations));
    });

    sendJson(res, 200, {
      restored: true,
      ...snapshot
    });
  } catch (error) {
    if (restoreConflictHandled(error, res)) return;
    const msg = (error as NodeJS.ErrnoException)?.code === "ENOENT"
      ? "History entry not found."
      : error instanceof WorkspaceStorageError ? error.message : "Restore failed.";
    sendJson(res, error instanceof WorkspaceStorageError ? 500 : 400, { error: msg });
  }
}
