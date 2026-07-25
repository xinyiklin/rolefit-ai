// Cover-letter workspace subsystem: discovers, loads, saves, trashes, and
// restores `cover-letter*.cover` files under the runtime workspace.
//
// Deliberately a sibling of workspace.ts rather than a generalization of it.
// Cover letters share the STORAGE PRIMITIVES (the serialization lock, atomic
// write, trash stamping, workspace listing) — those are imported, not copied —
// but they do not share the base resume's four-extension candidate list, its
// plain-text/CSV import paths, or its bundled-starter fallback. Parameterizing
// that battle-tested path for a simpler document would have complicated it for
// no gain on either side.
//
// A cover letter is only ever a strict `.cover` file here. Plain-text drafts stay
// browser downloads: the workspace holds documents the editor can reopen with
// formatting intact.

import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, readFile, readdir, rename } from "node:fs/promises";
import { join } from "node:path";

import { parseCoverLetterFile } from "@typeset/engine/lib/coverLetter.ts";
import { readBody, sendJson } from "./http.ts";
import {
  WorkspaceStorageError,
  atomicWriteWorkspaceFile,
  ensureJobWorkspace,
  isMissingFile,
  nextTrashStamp,
  readWorkspaceFiles,
  restoreConflictHandled,
  withWorkspaceLock,
  type WorkspaceLocations
} from "./workspace.ts";

const DEFAULT_COVER_LETTER_FILE = "cover-letter.cover";
const coverLetterVariantPattern = /^cover-letter(?:-[A-Za-z0-9][A-Za-z0-9_-]*)?\.cover$/;
// A cover letter is one page of prose; the resume's 200KB cap is generous here.
const MAX_COVER_LETTER_BYTES = 200_000;

export type CoverLetterOption = { fileName: string; label: string };
type CoverLetterHistoryEntry = { key: string; originalName: string; date: string };
type CoverLetterHistoryGroup = { variant: string; label: string; entries: CoverLetterHistoryEntry[] };

const friendlyWords = new Map([
  ["ai", "AI"],
  ["api", "API"],
  ["ats", "ATS"],
  ["llm", "LLM"],
  ["sde", "SDE"],
  ["swe", "SWE"],
  ["ui", "UI"],
  ["ux", "UX"]
]);

export function coverLetterLabel(fileName: string): string {
  const stem = fileName.replace(/\.cover$/i, "");
  if (stem === "cover-letter") return "Default";
  return stem
    .replace(/^cover-letter-/, "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => friendlyWords.get(part.toLowerCase()) ?? part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function assertCoverLetterFileName(fileName: unknown): string {
  const name = String(fileName ?? "").trim();
  if (!coverLetterVariantPattern.test(name) || name.includes("/") || name.includes("..")) {
    throw new Error("Choose a valid cover letter version.");
  }
  return name;
}

// Turn a user-supplied variant name into a safe file name. Mirrors the resume
// side's rule: unknown or unsafe input collapses to the default rather than
// escaping the workspace directory.
export function coverLetterFileNameForVariant(variant: unknown): string {
  const raw = String(variant ?? "").trim();
  if (!raw) return DEFAULT_COVER_LETTER_FILE;
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (!slug) return DEFAULT_COVER_LETTER_FILE;
  return `cover-letter-${slug}.cover`;
}

// Validate the complete bytes before anything is exposed or installed: a
// truncated or malformed .cover would otherwise reach the editor as corrupt JSON.
export function validateCoverLetterText(data: Buffer | string): string {
  const buffer = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  if (buffer.byteLength > MAX_COVER_LETTER_BYTES) {
    throw new WorkspaceStorageError("The cover letter is too large to read safely.");
  }
  const text = buffer.toString("utf8");
  try {
    parseCoverLetterFile(text);
  } catch {
    throw new WorkspaceStorageError("The saved .cover file is invalid. Restore a valid version from history before continuing.");
  }
  return text;
}

export async function readCoverLetterOptions(
  locations: WorkspaceLocations
): Promise<CoverLetterOption[]> {
  const files = await readWorkspaceFiles(locations);
  return files
    .filter((name) => coverLetterVariantPattern.test(name))
    .map((fileName) => ({ fileName, label: coverLetterLabel(fileName) }))
    .sort((a, b) => {
      if (a.fileName === DEFAULT_COVER_LETTER_FILE) return -1;
      if (b.fileName === DEFAULT_COVER_LETTER_FILE) return 1;
      return a.label.localeCompare(b.label);
    });
}

// Most recent archived versions from .trash/, grouped by variant and capped for
// display. Older backups stay on disk and remain restorable by hand — the cap is
// a display limit, not a prune.
async function readCoverLetterHistory(
  locations: WorkspaceLocations,
  perVariant = 3
): Promise<CoverLetterHistoryGroup[]> {
  const trashDir = join(locations.workspaceDir, ".trash");
  let entries: string[];
  try {
    entries = await readdir(trashDir);
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw new WorkspaceStorageError();
  }
  // Matches: 2026-07-25T16-30-45-123Z__cover-letter[-variant].cover
  const pattern = /^(.+?)__(cover-letter(?:-[A-Za-z0-9][A-Za-z0-9_-]*)?)\.cover$/;
  const matched = entries
    .map((name) => {
      const match = name.match(pattern);
      if (!match) return null;
      const date = new Date(match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, "T$1:$2:$3.$4Z"));
      return { fileName: name, stem: match[2], stamp: match[1], date };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.stamp.localeCompare(a.stamp));

  const groups = new Map<string, CoverLetterHistoryGroup>();
  for (const entry of matched) {
    let group = groups.get(entry.stem);
    if (!group) {
      group = { variant: entry.stem, label: coverLetterLabel(`${entry.stem}.cover`), entries: [] };
      groups.set(entry.stem, group);
    }
    if (group.entries.length >= perVariant) continue;
    group.entries.push({
      key: entry.fileName,
      originalName: `${entry.stem}.cover`,
      date: Number.isNaN(entry.date.getTime()) ? entry.stamp : entry.date.toISOString()
    });
  }

  return [...groups.values()].sort((a, b) => {
    if (a.variant === "cover-letter") return -1;
    if (b.variant === "cover-letter") return 1;
    return a.label.localeCompare(b.label);
  });
}

async function trashCoverLetterFile(name: string, locations: WorkspaceLocations): Promise<void> {
  const trashDir = join(locations.workspaceDir, ".trash");
  await mkdir(trashDir, { recursive: true });
  try {
    await rename(join(locations.workspaceDir, name), join(trashDir, `${nextTrashStamp()}__${name}`));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }
}

async function coverLetterSnapshot(locations: WorkspaceLocations) {
  return {
    coverLetterOptions: await readCoverLetterOptions(locations),
    coverLetterHistory: await readCoverLetterHistory(locations)
  };
}

/** Snapshot fields merged into GET /api/workspace so one fetch seeds both editors. */
export async function readCoverLetterWorkspace(locations: WorkspaceLocations) {
  return coverLetterSnapshot(locations);
}

// POST { fileName?, variant?, text }  → save (archiving any current version first)
export async function handleWorkspaceCoverLetter(
  req: IncomingMessage,
  res: ServerResponse,
  locations: WorkspaceLocations
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  try {
    const body = JSON.parse(await readBody(req));
    const rawText = String(body.text ?? "");
    if (Buffer.byteLength(rawText, "utf8") > MAX_COVER_LETTER_BYTES) {
      sendJson(res, 413, { error: "Cover letter is too large to save." });
      return;
    }
    try {
      parseCoverLetterFile(rawText);
    } catch {
      sendJson(res, 400, { error: "Save a valid Typeset .cover file." });
      return;
    }

    const targetName = body.fileName
      ? assertCoverLetterFileName(body.fileName)
      : coverLetterFileNameForVariant(body.variant);

    const snapshot = await withWorkspaceLock(async () => {
      await ensureJobWorkspace(locations.workspaceDir);
      // Archive before overwriting so every save is recoverable from history.
      await trashCoverLetterFile(targetName, locations);
      await atomicWriteWorkspaceFile(join(locations.workspaceDir, targetName), rawText);
      return coverLetterSnapshot(locations);
    });

    sendJson(res, 200, {
      saved: true,
      fileName: targetName,
      label: coverLetterLabel(targetName),
      ...snapshot
    });
  } catch (error) {
    if (restoreConflictHandled(error, res)) return;
    sendJson(res, error instanceof WorkspaceStorageError ? 500 : 400, {
      error: error instanceof WorkspaceStorageError
        ? error.message
        : error instanceof Error ? error.message : "Cover letter save failed."
    });
  }
}

// POST { fileName } → load one saved variant
export async function handleSelectCoverLetter(
  req: IncomingMessage,
  res: ServerResponse,
  locations: WorkspaceLocations
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  try {
    const body = JSON.parse(await readBody(req, 2_000));
    const fileName = assertCoverLetterFileName(body.fileName);
    const result = await withWorkspaceLock(async () => {
      await ensureJobWorkspace(locations.workspaceDir);
      try {
        const data = await readFile(join(locations.workspaceDir, fileName));
        return { text: validateCoverLetterText(data), ...(await coverLetterSnapshot(locations)) };
      } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
      }
    });
    if (!result) {
      sendJson(res, 404, { error: "Cover letter version not found." });
      return;
    }
    sendJson(res, 200, { fileName, label: coverLetterLabel(fileName), ...result });
  } catch (error) {
    if (restoreConflictHandled(error, res)) return;
    sendJson(res, error instanceof WorkspaceStorageError ? 500 : 400, {
      error: error instanceof WorkspaceStorageError
        ? error.message
        : error instanceof Error ? error.message : "Cover letter load failed."
    });
  }
}

// POST { key } → reinstall an archived version (archiving the current one first)
export async function handleRestoreCoverLetter(
  req: IncomingMessage,
  res: ServerResponse,
  locations: WorkspaceLocations
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
    const keyMatch = key.match(/^.+?__(cover-letter(?:-[A-Za-z0-9][A-Za-z0-9_-]*)?\.cover)$/);
    if (!keyMatch) {
      sendJson(res, 400, { error: "Invalid history key." });
      return;
    }
    const targetName = keyMatch[1];

    const result = await withWorkspaceLock(async () => {
      await ensureJobWorkspace(locations.workspaceDir);
      // Validate the archived bytes before displacing the current good version.
      const data = await readFile(join(locations.workspaceDir, ".trash", key));
      const text = validateCoverLetterText(data);
      await trashCoverLetterFile(targetName, locations);
      await atomicWriteWorkspaceFile(join(locations.workspaceDir, targetName), data);
      return { text, ...(await coverLetterSnapshot(locations)) };
    });

    sendJson(res, 200, {
      restored: true,
      fileName: targetName,
      label: coverLetterLabel(targetName),
      ...result
    });
  } catch (error) {
    if (restoreConflictHandled(error, res)) return;
    sendJson(res, error instanceof WorkspaceStorageError ? 500 : 400, {
      error: error instanceof WorkspaceStorageError
        ? error.message
        : isMissingFile(error) ? "That cover letter version is no longer in history."
        : "Cover letter restore failed."
    });
  }
}
