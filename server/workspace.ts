// Base-resume workspace subsystem: discovers, loads, saves, trashes, and restores
// the root-level structured (.resume) / plain-text base resumes under
// job-search-workspace/. Split out of server.ts; the four /api/workspace* route
// handlers plus the file readers/writers they share live here. JSON I/O and HTTP
// helpers are imported directly, matching the server/ai/* module style.
//
// jobWorkspaceDir is exported so the application-tracker and extension routes can
// close over the same workspace directory without a factory.

import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { readBody, sendJson } from "./http.ts";

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

const root = process.cwd();
export const jobWorkspaceDir = join(root, "job-search-workspace");
const baseResumeCandidates = [
  "base-resume.resume",
  "base-resume.txt",
  "base-resume.md",
  "base-resume.csv"
];
const baseResumeVariantPattern = /^base-resume(?:-[A-Za-z0-9][A-Za-z0-9_-]*)?\.resume$/;

export async function ensureJobWorkspace(): Promise<void> {
  await mkdir(jobWorkspaceDir, { recursive: true });
}

async function readWorkspaceFiles(): Promise<string[]> {
  try {
    const entries = await readdir(jobWorkspaceDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => name !== ".DS_Store")
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function assertBaseResumeFileName(fileName: unknown): string {
  const name = String(fileName ?? "").trim();
  if (!baseResumeVariantPattern.test(name) || name.includes("/") || name.includes("..")) {
    throw new Error("Choose a valid base resume version.");
  }
  return name;
}

function baseResumeLabel(fileName: string): string {
  const base = fileName.replace(/\.(resume|txt|md|csv)$/i, "");
  if (base === "base-resume") return "Default";
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
  return base
    .replace(/^base-resume-/, "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => friendlyWords.get(part.toLowerCase()) ?? part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export async function readWorkspaceBaseResume(requestedFileName?: string): Promise<BaseResumeResult> {
  const candidates = requestedFileName
    ? [assertBaseResumeFileName(requestedFileName)]
    : [
        ...(await readBaseResumeOptions()).map((option) => option.fileName),
        ...baseResumeCandidates.filter((name) => !baseResumeVariantPattern.test(name))
      ];

  const uniqueCandidates = [...new Set(candidates)];
  for (const fileName of uniqueCandidates) {
    const filePath = join(jobWorkspaceDir, fileName);
    try {
      const data = await readFile(filePath);
      // Cap generously: a .resume file is raw JSON the client must JSON.parse, so
      // truncation would corrupt it — 200k covers a full structured resume.
      const text = data.toString("utf8").slice(0, 200_000);
      if (text.trim().length < 80) continue;
      return {
        exists: true,
        fileName,
        label: baseResumeLabel(fileName),
        kind: extname(fileName).toLowerCase().replace(".", "") || "text",
        text
      };
    } catch {
      // Try the next supported base-resume file.
    }
  }

  // No workspace file found — fall back to the bundled starter .resume so the
  // editor is never empty on a fresh install.
  try {
    const starterPath = join(root, "server/starter.resume");
    const starterText = await readFile(starterPath, "utf8");
    return { exists: false, text: starterText, kind: "resume", fileName: "starter.resume" };
  } catch {
    return { exists: false };
  }
}

async function readBaseResumeOptions(): Promise<{ fileName: string; label: string; kind: string }[]> {
  const files = await readWorkspaceFiles();
  return files
    .filter((name) => baseResumeVariantPattern.test(name))
    .map((fileName) => ({
      fileName,
      label: baseResumeLabel(fileName),
      kind: "resume"
    }))
    .sort((a, b) => {
      if (a.fileName === "base-resume.resume") return -1;
      if (b.fileName === "base-resume.resume") return 1;
      return a.label.localeCompare(b.label);
    });
}

// Clear the app-managed default base resume, but never hard-delete: move every
// known default format into job-search-workspace/.trash/ with a timestamp so a
// removed or replaced base resume is always recoverable. Named variants such as
// base-resume-fullstack.resume stay in place.
async function clearBaseResumeFiles(): Promise<void> {
  const trashDir = join(jobWorkspaceDir, ".trash");
  await mkdir(trashDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await Promise.all(
    baseResumeCandidates.map(async (name) => {
      try {
        await rename(join(jobWorkspaceDir, name), join(trashDir, `${stamp}__${name}`));
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
      }
    })
  );
}

// Back up a single base-resume file (including named variants) to .trash/.
async function trashBaseFile(name: string): Promise<void> {
  const trashDir = join(jobWorkspaceDir, ".trash");
  await mkdir(trashDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    await rename(join(jobWorkspaceDir, name), join(trashDir, `${stamp}__${name}`));
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
// history spans base-resume.resume and base-resume.txt consolidates into one group.
// Matches both default (base-resume.resume) and named variants (base-resume-fullstack.resume).
async function readBaseResumeHistory(perVariant = 3): Promise<HistoryGroup[]> {
  const trashDir = join(jobWorkspaceDir, ".trash");
  let entries: string[];
  try {
    entries = await readdir(trashDir);
  } catch {
    return [];
  }
  // Matches: 2026-06-10T16-30-45-123Z__base-resume[-variant].(resume|txt|md|csv)
  const baseResumePattern = /^(.+?)__(base-resume(?:-[A-Za-z0-9][A-Za-z0-9_-]*)?)\.(resume|txt|md|csv)$/;
  const matched = (entries
    .map((name): HistoryMatch | null => {
      const m = name.match(baseResumePattern);
      if (!m) return null;
      const stem = m[2]; // e.g. "base-resume" or "base-resume-frontend"
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
    if (a.variant === "base-resume") return -1;
    if (b.variant === "base-resume") return 1;
    return a.label.localeCompare(b.label);
  });
}

export async function handleWorkspace(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Use GET." });
    return;
  }

  try {
    await ensureJobWorkspace();
    sendJson(res, 200, {
      path: jobWorkspaceDir,
      baseResume: await readWorkspaceBaseResume(),
      baseResumeOptions: await readBaseResumeOptions(),
      baseResumeHistory: await readBaseResumeHistory(),
      files: await readWorkspaceFiles()
    });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Workspace check failed." });
  }
}

export async function handleSelectBaseResume(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  try {
    await ensureJobWorkspace();
    const body = JSON.parse(await readBody(req, 2_000));
    const fileName = assertBaseResumeFileName(body.fileName);
    const baseResume = await readWorkspaceBaseResume(fileName);
    if (!baseResume.exists) {
      sendJson(res, 404, { error: "Base resume version not found." });
      return;
    }
    sendJson(res, 200, {
      path: jobWorkspaceDir,
      baseResume,
      baseResumeOptions: await readBaseResumeOptions(),
      baseResumeHistory: await readBaseResumeHistory(),
      files: await readWorkspaceFiles()
    });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Base resume load failed." });
  }
}

export async function handleWorkspaceBaseResume(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "DELETE") {
    try {
      await ensureJobWorkspace();
      await clearBaseResumeFiles();
      sendJson(res, 200, {
        removed: true,
        path: jobWorkspaceDir,
        baseResume: { exists: false },
        baseResumeOptions: await readBaseResumeOptions(),
        baseResumeHistory: await readBaseResumeHistory(),
        files: await readWorkspaceFiles()
      });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Base resume removal failed." });
    }
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST or DELETE." });
    return;
  }

  try {
    await ensureJobWorkspace();
    const body = JSON.parse(await readBody(req));
    const fileName = String(body.fileName ?? "").trim();
    const extension = extname(fileName).toLowerCase();

    if (![".txt", ".md", ".csv", ".resume", ""].includes(extension)) {
      sendJson(res, 400, { error: "Save a RESUME, TXT, MD, or CSV resume as the base resume." });
      return;
    }

    // A .resume envelope is raw JSON the client must JSON.parse, so truncating it
    // mid-document would write a corrupt file — reject oversize outright. Plain
    // text (.txt/.md/.csv) can be capped by slicing without breaking its format.
    const isResume = extension === ".resume";
    const rawText = String(body.text ?? "");
    if (isResume && rawText.length > 200_000) {
      sendJson(res, 413, { error: "Resume file is too large to save." });
      return;
    }
    const text = isResume ? rawText : rawText.slice(0, 200_000);
    if (text.trim().length < 80) {
      sendJson(res, 400, { error: "Base resume text is too short to save." });
      return;
    }

    // Preserve active workspace .resume variants in place. Arbitrary uploaded
    // .resume names still normalize to the default base-resume.resume.
    let targetName = "base-resume.txt";
    if (isResume) {
      targetName = baseResumeVariantPattern.test(fileName) ? assertBaseResumeFileName(fileName) : "base-resume.resume";
    }
    if (targetName === "base-resume.resume" || !isResume) {
      await clearBaseResumeFiles();
    } else {
      // Named variant: back it up before overwriting so it appears in version history.
      await trashBaseFile(targetName);
    }
    await writeFile(join(jobWorkspaceDir, targetName), text, "utf8");
    sendJson(res, 200, {
      saved: true,
      path: jobWorkspaceDir,
      baseResume: {
        exists: true,
        fileName: targetName,
        kind: isResume ? "resume" : "txt",
        text
      },
      baseResumeOptions: await readBaseResumeOptions(),
      baseResumeHistory: await readBaseResumeHistory(),
      files: await readWorkspaceFiles()
    });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Base resume save failed." });
  }
}

export async function handleRestoreBaseResume(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }
  try {
    await ensureJobWorkspace();
    const body = JSON.parse(await readBody(req, 1_000));
    const key = String(body.key ?? "");
    if (!key || key.includes("/") || key.includes("..")) {
      sendJson(res, 400, { error: "Invalid history key." });
      return;
    }
    const trashDir = join(jobWorkspaceDir, ".trash");
    const sourcePath = join(trashDir, key);

    // Extract the original filename from the key (after the stamp prefix).
    const keyMatch = key.match(/^.+?__(base-resume(?:-[A-Za-z0-9][A-Za-z0-9_-]*)?\.(?:resume|txt|md|csv))$/);
    if (!keyMatch) {
      sendJson(res, 400, { error: "Invalid history key." });
      return;
    }
    const targetName = keyMatch[1];
    const isNamedVariant = baseResumeVariantPattern.test(targetName) && targetName !== "base-resume.resume";

    // Read the archived file, back up the current version, write the restored version.
    const data = await readFile(sourcePath);
    if (isNamedVariant) {
      await trashBaseFile(targetName);
    } else {
      await clearBaseResumeFiles();
    }
    await writeFile(join(jobWorkspaceDir, targetName), data);

    sendJson(res, 200, {
      restored: true,
      path: jobWorkspaceDir,
      baseResume: await readWorkspaceBaseResume(),
      baseResumeOptions: await readBaseResumeOptions(),
      baseResumeHistory: await readBaseResumeHistory(),
      files: await readWorkspaceFiles()
    });
  } catch (error) {
    const msg = (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "History entry not found." : error instanceof Error ? error.message : "Restore failed.";
    sendJson(res, 400, { error: msg });
  }
}
