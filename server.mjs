import { createServer } from "node:http";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { createServer as createViteServer } from "vite";
import { handlePolish } from "./server/ai/polish.mjs";
import { getDefaultModel, getDefaultProvider } from "./server/ai/providers.mjs";
import { handleApplicationAnswers } from "./server/ai/applicationAnswers.mjs";
import { handleCoverLetter } from "./server/ai/coverLetter.mjs";
import {
  listTemplates,
  renderResumeTex,
  renderResumeTexFromSchema,
  extractPlainTextFromLatex,
  checkTectonicAvailability,
  compileTexToPdf,
  defaultTemplateId
} from "./server/latex/index.mjs";
import {
  readApplications,
  writeApplications,
  applicationsFilePath
} from "./server/applications/index.mjs";
import {
  base64ToBuffer,
  bufferToBase64,
  extractDocxResume
} from "./server/docx.mjs";
import { FetchTimeoutError, readBody, sendJson } from "./server/http.mjs";
import { BlockedHostError, DnsError, fetchPublicHtml, isPublicHttpUrl } from "./server/network.mjs";
import { quickScore, normalizeUrl, findMatchingApplication, extractJobMeta } from "./server/extension/index.mjs";

const root = process.cwd();
let extensionInbox = null; // { text: string, url: string } | null
const isProduction = process.env.NODE_ENV === "production";
const jobWorkspaceDir = join(root, "job-search-workspace");
const baseResumeCandidates = [
  "base-resume.tex",
  "base-resume.docx",
  "base-resume.txt",
  "base-resume.md",
  "base-resume.csv"
];
const baseResumeTexPattern = /^base-resume(?:-[A-Za-z0-9][A-Za-z0-9_-]*)?\.tex$/;

async function loadLocalEnv() {
  try {
    const env = await readFile(join(root, ".env"), "utf8");
    for (const line of env.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // Local .env is optional.
  }
}

await loadLocalEnv();
await ensureJobWorkspace();

const port = Number(process.env.PORT ?? 5181);
// Bind to loopback by default: this app has no auth and exposes URL-fetch,
// file-storage, and LaTeX/DOCX-compile endpoints, so it must not be reachable
// from other devices on the network. Set HOST=0.0.0.0 to opt into LAN access.
const host = process.env.HOST || "127.0.0.1";

async function ensureJobWorkspace() {
  await mkdir(jobWorkspaceDir, { recursive: true });
}

const APPLICATION_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

function applicationResumeDir(id) {
  if (!APPLICATION_ID_RE.test(id)) return null;
  const dir = join(jobWorkspaceDir, "applications", id);
  // Defense in depth: ensure the resolved path stays inside the workspace.
  const base = resolve(jobWorkspaceDir, "applications");
  if (!resolve(dir).startsWith(base + sep) && resolve(dir) !== base) return null;
  return dir;
}

function decodeRouteSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

async function handleImportResumeDocx(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  try {
    const { docxBase64 } = JSON.parse(await readBody(req));
    const result = await extractDocxResume(docxBase64);

    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "DOCX import failed." });
  }
}

async function readWorkspaceFiles() {
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

function assertBaseResumeFileName(fileName) {
  const name = String(fileName ?? "").trim();
  if (!baseResumeTexPattern.test(name) || name.includes("/") || name.includes("..")) {
    throw new Error("Choose a valid base resume version.");
  }
  return name;
}

function baseResumeLabel(fileName) {
  const base = fileName.replace(/\.(docx|tex|txt|md|csv)$/i, "");
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

async function readWorkspaceBaseResume(requestedFileName) {
  const candidates = requestedFileName
    ? [assertBaseResumeFileName(requestedFileName)]
    : [
        ...(await readBaseResumeOptions()).map((option) => option.fileName),
        ...baseResumeCandidates.filter((name) => !baseResumeTexPattern.test(name))
      ];

  const uniqueCandidates = [...new Set(candidates)];
  for (const fileName of uniqueCandidates) {
    const filePath = join(jobWorkspaceDir, fileName);
    try {
      const data = await readFile(filePath);
      const extension = extname(fileName).toLowerCase();
      if (extension === ".docx") {
        const docxBase64 = bufferToBase64(data);
        const parsed = await extractDocxResume(docxBase64);
        return {
          exists: true,
          fileName,
          label: baseResumeLabel(fileName),
          kind: "docx",
          text: parsed.text,
          paragraphs: parsed.paragraphs,
          docxBase64
        };
      }

      const text = data.toString("utf8").slice(0, 45_000);
      if (text.trim().length < 80) continue;
      return {
        exists: true,
        fileName,
        label: baseResumeLabel(fileName),
        kind: extension.replace(".", "") || "text",
        text
      };
    } catch {
      // Try the next supported base-resume file.
    }
  }

  // No workspace file found — fall back to the bundled Jake's starter template so
  // the editor is never empty on a fresh install.
  try {
    const starterPath = join(root, "server/latex/templates/jakes-starter.tex");
    const starterText = await readFile(starterPath, "utf8");
    return { exists: false, text: starterText, kind: "tex", fileName: "jakes-starter.tex" };
  } catch {
    return { exists: false };
  }
}

async function readBaseResumeOptions() {
  const files = await readWorkspaceFiles();
  return files
    .filter((name) => baseResumeTexPattern.test(name))
    .map((fileName) => ({
      fileName,
      label: baseResumeLabel(fileName),
      kind: "tex"
    }))
    .sort((a, b) => {
      if (a.fileName === "base-resume.tex") return -1;
      if (b.fileName === "base-resume.tex") return 1;
      return a.label.localeCompare(b.label);
    });
}

// Clear the app-managed default base resume, but never hard-delete: move every
// known default format into job-search-workspace/.trash/ with a timestamp so a
// removed or replaced base resume is always recoverable. Named variants such as
// base-resume-fullstack.tex stay in place.
async function clearBaseResumeFiles() {
  const trashDir = join(jobWorkspaceDir, ".trash");
  await mkdir(trashDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await Promise.all(
    baseResumeCandidates.map(async (name) => {
      try {
        await rename(join(jobWorkspaceDir, name), join(trashDir, `${stamp}__${name}`));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    })
  );
}

// Back up a single base-resume file (including named variants) to .trash/.
async function trashBaseFile(name) {
  const trashDir = join(jobWorkspaceDir, ".trash");
  await mkdir(trashDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    await rename(join(jobWorkspaceDir, name), join(trashDir, `${stamp}__${name}`));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

// List the most recent base-resume versions from .trash/, grouped by variant so
// the UI can show one expandable group per variant. Each group keeps only the
// `perVariant` most recent entries (default 3); older backups stay in .trash and
// remain restorable by hand — this is a display cap, not a destructive prune.
// The variant identity is the file stem (extension-agnostic) so a Default whose
// history spans base-resume.tex and base-resume.txt consolidates into one group.
// Matches both default (base-resume.tex) and named variants (base-resume-fullstack.tex).
async function readBaseResumeHistory(perVariant = 3) {
  const trashDir = join(jobWorkspaceDir, ".trash");
  let entries;
  try {
    entries = await readdir(trashDir);
  } catch {
    return [];
  }
  // Matches: 2026-06-10T16-30-45-123Z__base-resume[-variant].(docx|tex|txt|md|csv)
  const baseResumePattern = /^(.+?)__(base-resume(?:-[A-Za-z0-9][A-Za-z0-9_-]*)?)\.(docx|tex|txt|md|csv)$/;
  const matched = entries
    .map((name) => {
      const m = name.match(baseResumePattern);
      if (!m) return null;
      const stem = m[2]; // e.g. "base-resume" or "base-resume-frontend"
      const originalName = `${stem}.${m[3]}`;
      // Reconstruct a rough ISO date for display; the raw stamp is authoritative.
      const date = new Date(m[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, "T$1:$2:$3.$4Z"));
      return { fileName: name, stem, originalName, kind: m[3], stamp: m[1], date };
    })
    .filter(Boolean)
    .sort((a, b) => b.stamp.localeCompare(a.stamp));

  // Group newest-first by variant stem, then cap each group to `perVariant`.
  const groups = new Map();
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

async function handleWorkspace(req, res) {
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

async function handleSelectBaseResume(req, res) {
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

async function handleWorkspaceBaseResume(req, res) {
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

    if (extension === ".docx") {
      const docxBase64 = String(body.fileBase64 ?? "");
      const parsed = await extractDocxResume(docxBase64);
      await clearBaseResumeFiles();
      await writeFile(join(jobWorkspaceDir, "base-resume.docx"), base64ToBuffer(docxBase64));
      sendJson(res, 200, {
        saved: true,
        path: jobWorkspaceDir,
        baseResume: {
          exists: true,
          fileName: "base-resume.docx",
          kind: "docx",
          text: parsed.text,
          paragraphs: parsed.paragraphs,
          docxBase64
        },
        baseResumeOptions: await readBaseResumeOptions(),
        baseResumeHistory: await readBaseResumeHistory(),
        files: await readWorkspaceFiles()
      });
      return;
    }

    if (![".txt", ".md", ".csv", ".tex", ""].includes(extension)) {
      sendJson(res, 400, { error: "Save a DOCX, TEX, TXT, MD, or CSV resume as the base resume." });
      return;
    }

    const text = String(body.text ?? "").slice(0, 45_000);
    if (text.trim().length < 80) {
      sendJson(res, 400, { error: "Base resume text is too short to save." });
      return;
    }

    // Preserve active workspace LaTeX variants in place. Arbitrary uploaded
    // .tex names still normalize to the default base-resume.tex.
    const isTex = extension === ".tex";
    let targetName = "base-resume.txt";
    if (isTex) {
      targetName = baseResumeTexPattern.test(fileName) ? assertBaseResumeFileName(fileName) : "base-resume.tex";
    }
    if (targetName === "base-resume.tex" || !isTex) {
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
        kind: isTex ? "tex" : "txt",
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

async function handleRestoreBaseResume(req, res) {
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
    const keyMatch = key.match(/^.+?__(base-resume(?:-[A-Za-z0-9][A-Za-z0-9_-]*)?\.(?:docx|tex|txt|md|csv))$/);
    if (!keyMatch) {
      sendJson(res, 400, { error: "Invalid history key." });
      return;
    }
    const targetName = keyMatch[1];
    const isNamedVariant = baseResumeTexPattern.test(targetName) && targetName !== "base-resume.tex";

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
    const msg = error?.code === "ENOENT" ? "History entry not found." : error instanceof Error ? error.message : "Restore failed.";
    sendJson(res, 400, { error: msg });
  }
}

async function handleListTemplates(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Use GET." });
    return;
  }

  try {
    const tectonic = await checkTectonicAvailability();
    sendJson(res, 200, {
      templates: listTemplates(),
      defaultTemplateId,
      tectonic
    });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Template list failed." });
  }
}

async function handleRenderResumeLatex(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  try {
    const body = JSON.parse(await readBody(req));
    const resumeText = String(body.resumeText ?? "");
    const templateId = String(body.templateId ?? defaultTemplateId);
    const wantsPdf = Boolean(body.wantsPdf);
    // rawTex: the text already IS a full LaTeX document (preserve-format on a
    // .tex source) — compile it as-is instead of pouring it into a template.
    const rawTex = Boolean(body.rawTex);
    // resume: structured editor data — render straight through the template,
    // skipping the lossy plain-text parse (Compile Preview path).
    const structured = body.resume && typeof body.resume === "object" ? body.resume : null;
    // docStyle: editor's Format menu values (spacing/leading) — when present, the
    // template renders with matching pt overrides so the PDF mirrors the editor.
    const docStyle = body.docStyle && typeof body.docStyle === "object" ? body.docStyle : null;

    // Cap the structured payload before rendering (defense-in-depth, mirrors the
    // DOCX export cap) so a pathological client body can't blow up the renderer.
    if (structured && JSON.stringify(structured).length > 400_000) {
      sendJson(res, 400, { error: "Resume data is too large to render." });
      return;
    }

    if (!structured && !rawTex && !resumeText.trim()) {
      sendJson(res, 400, { error: "Resume text is empty." });
      return;
    }

    // Cap the text (template) and rawTex branches too — reject rather than slice,
    // since truncating LaTeX mid-document would corrupt the Tectonic compile.
    // Mirrors the import-resume-tex guard.
    if (resumeText.length > 200_000) {
      sendJson(res, 400, { error: "Resume text is too large to render." });
      return;
    }

    let tex;
    let resolvedTemplateId;
    if (structured) {
      ({ tex, templateId: resolvedTemplateId } = renderResumeTexFromSchema({ schema: structured, templateId, docStyle }));
    } else if (rawTex) {
      tex = resumeText;
      resolvedTemplateId = "raw";
    } else {
      ({ tex, templateId: resolvedTemplateId } = renderResumeTex({ resumeText, templateId, docStyle }));
    }

    let pdfBase64 = null;
    let pdfError = null;
    if (wantsPdf) {
      try {
        const pdfBuffer = await compileTexToPdf(tex);
        pdfBase64 = pdfBuffer.toString("base64");
      } catch (error) {
        pdfError = {
          code: error?.code ?? "COMPILE_FAILED",
          message: error instanceof Error ? error.message : "PDF compile failed."
        };
      }
    }

    sendJson(res, 200, { tex, templateId: resolvedTemplateId, pdfBase64, pdfError });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "LaTeX render failed." });
  }
}

async function handleImportResumeTex(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  try {
    const body = JSON.parse(await readBody(req));
    const tex = String(body.tex ?? "");
    if (!tex.trim()) {
      sendJson(res, 400, { error: "LaTeX source is empty." });
      return;
    }
    // A real résumé .tex is a few KB. The brace-balanced reader is worst-case
    // O(n²) on pathological unbalanced-brace input, so reject oversized payloads
    // before parsing to keep one cheap upload from freezing the event loop.
    if (tex.length > 200_000) {
      sendJson(res, 400, { error: "LaTeX source is too large to import." });
      return;
    }
    const text = extractPlainTextFromLatex(tex);
    if (!text.trim()) {
      sendJson(res, 422, { error: "Could not extract text from the LaTeX source. Paste the resume content directly instead." });
      return;
    }
    sendJson(res, 200, { text });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "LaTeX import failed." });
  }
}

async function handleListApplications(req, res) {
  try {
    const applications = await readApplications(jobWorkspaceDir);
    sendJson(res, 200, {
      applications,
      path: applicationsFilePath(jobWorkspaceDir)
    });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Application list failed." });
  }
}

async function handleSaveApplications(req, res) {
  try {
    const body = JSON.parse(await readBody(req));
    const incoming = Array.isArray(body.applications) ? body.applications : [];
    const applications = await writeApplications(jobWorkspaceDir, incoming);
    sendJson(res, 200, { applications });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Application save failed." });
  }
}

// Persist a tailored resume's .tex source and/or compiled PDF for one
// application under job-search-workspace/applications/<id>/ (gitignored). The
// returned resumeArtifacts mirrors the shape the application sanitizer stores.
async function handleSaveApplicationResume(req, res, id) {
  if (req.method !== "POST") { sendJson(res, 405, { error: "Use POST." }); return; }
  const dir = applicationResumeDir(id);
  if (!dir) { sendJson(res, 400, { error: "Invalid application id." }); return; }
  try {
    const body = JSON.parse(await readBody(req));
    const tex = typeof body.tex === "string" ? body.tex : "";
    const pdfBase64 = typeof body.pdfBase64 === "string" ? body.pdfBase64 : "";
    const fileName = typeof body.fileName === "string" ? body.fileName.slice(0, 200) : "";
    const templateId = typeof body.templateId === "string" ? body.templateId.slice(0, 80) : "";
    if (!tex && !pdfBase64) { sendJson(res, 400, { error: "No resume artifacts to save." }); return; }
    // Size caps: tex ~1MB of chars, pdf ~8MB decoded.
    if (tex.length > 1_000_000) { sendJson(res, 413, { error: "TeX source too large." }); return; }
    let pdfBuffer = null;
    if (pdfBase64) {
      pdfBuffer = base64ToBuffer(pdfBase64, "PDF");
      if (pdfBuffer.length > 8_000_000) { sendJson(res, 413, { error: "PDF too large." }); return; }
    }
    await mkdir(dir, { recursive: true });
    let hasTex = false;
    let hasPdf = false;
    if (tex) { await writeFile(join(dir, "resume.tex"), tex, "utf8"); hasTex = true; }
    if (pdfBuffer) {
      await writeFile(join(dir, "resume.pdf"), pdfBuffer);
      hasPdf = true;
    }
    sendJson(res, 200, {
      resumeArtifacts: { hasTex, hasPdf, fileName, templateId, savedAt: new Date().toISOString() }
    });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Saving resume artifacts failed." });
  }
}

// Stream a saved resume artifact (.tex or .pdf) back as a file download. The
// browser names it via the <a download> attribute; the Content-Disposition
// filename is only a fallback, so a fixed "resume" name is fine here.
async function handleApplicationResumeFile(req, res, id, ext) {
  if (req.method !== "GET") { sendJson(res, 405, { error: "Use GET." }); return; }
  const dir = applicationResumeDir(id);
  if (!dir) { sendJson(res, 400, { error: "Invalid application id." }); return; }
  const isPdf = ext === "pdf";
  const filePath = join(dir, isPdf ? "resume.pdf" : "resume.tex");
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": isPdf ? "application/pdf" : "application/x-tex; charset=utf-8",
      "Content-Disposition": `attachment; filename="resume.${isPdf ? "pdf" : "tex"}"`,
      "Content-Length": data.length,
      "Cache-Control": "no-store"
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: "Resume artifact not found." });
  }
}

// Decode a numeric character reference, clamping control chars (which could
// inject fake structure into the prompt) and rejecting out-of-range values.
// fromCodePoint (not fromCharCode) so astral code points aren't truncated.
function fromCharRef(code) {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return " ";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

// Convert posting HTML to readable text while keeping paragraph/bullet breaks
// (the front-end distiller and the description box both read better with them).
function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|ul|ol|tr|section|header|footer|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#39;|&rsquo;|&lsquo;|&apos;/gi, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&#(\d+);/g, (_, n) => fromCharRef(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => fromCharRef(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlAttr(tag, attr) {
  const match = String(tag || "").match(new RegExp(`${attr}=["']([^"']*)["']`, "i"));
  return match?.[1] ?? "";
}

function metaContent(html, name) {
  const meta = String(html || "")
    .match(/<meta\b[^>]*>/gi)
    ?.find((tag) => {
      const key = htmlAttr(tag, "name") || htmlAttr(tag, "property");
      return key.toLowerCase() === name.toLowerCase();
    });
  return meta ? htmlToText(htmlAttr(meta, "content")) : "";
}

function linkedInHeaderLines(html) {
  const title = metaContent(html, "og:title") || metaContent(html, "twitter:title");
  const match = title.match(/^(.+?)\s+hiring\s+(.+?)\s+in\s+(.+?)\s*\|\s*LinkedIn\b/i);
  if (!match) return [];
  return [
    `Company: ${match[1].trim()}`,
    `Role: ${match[2].trim()}`,
    `Location: ${match[3].trim()}`
  ];
}

function linkedInCriteriaLines(html) {
  const items = [...String(html || "").matchAll(/<li[^>]*class=["'][^"']*description__job-criteria-item[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)];
  return items
    .map((item) => htmlToText(item[1]).split("\n").map((line) => line.trim()).filter(Boolean))
    .map((parts) => {
      if (parts.length < 2) return "";
      return `${parts[0].replace(/:$/, "")}: ${parts.slice(1).join(" ")}`;
    })
    .filter(Boolean);
}

function linkedInJobText(html) {
  if (!/(\bshow-more-less-html__markup\b|\bdescription__job-criteria-item\b)/i.test(String(html || ""))) {
    return "";
  }
  const body = [...String(html || "").matchAll(/<div[^>]*class=["'][^"']*show-more-less-html__markup[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
    .map((match) => htmlToText(match[1]))
    .filter((text) => text.length > 80);
  if (!body.length) return "";

  const lines = [...linkedInHeaderLines(html), ...linkedInCriteriaLines(html), body.join("\n\n")];
  return htmlToText(lines.join("\n\n"));
}

// Workday job pages render the description client-side, but expose it via their
// CXS JSON API. Rewrite a public job URL to that endpoint when we recognize the
// host. Career-site links use /Site/job/Loc/Title_R123 (older) or
// /Site/details/Title_R123 (newer share links); both map to .../wday/cxs/<tenant>/<site>/job/...
function workdayCxsUrl(u) {
  if (!/(^|\.)myworkdayjobs\.com$/i.test(u.hostname)) return null;
  const tenant = u.hostname.split(".")[0];
  const segs = u.pathname.split("/").filter(Boolean);
  const sepIdx = segs.findIndex((seg) => seg === "job" || seg === "details");
  if (sepIdx < 1 || sepIdx === segs.length - 1) return null; // need a site segment + a job path
  const site = segs[sepIdx - 1];
  const jobPath = segs.slice(sepIdx + 1).join("/");
  if (!tenant || !site || !jobPath) return null;
  try {
    return new URL(`https://${u.hostname}/wday/cxs/${tenant}/${site}/job/${jobPath}`);
  } catch {
    return null;
  }
}

async function importFromWorkday(apiUrl) {
  const response = await fetchPublicHtml(apiUrl, { Accept: "application/json" });
  if (!response.ok) return "";
  let info;
  try {
    info = JSON.parse(await response.text())?.jobPostingInfo;
  } catch {
    return "";
  }
  if (!info) return "";
  const body = htmlToText(info.jobDescription);
  if (body.length < 200) return "";
  const header = [info.title, info.location].filter(Boolean).join(" · ");
  return (header ? `${header}\n\n` : "") + body;
}

// Mirrors isLikelyProse in src/lib/jobExtract.ts. "$" stays out of the char
// class so salary lines like "$90k-$110k" are not penalized; "$(...)" jQuery
// calls are still caught by the JS-pattern test.
function isCodeShapedLine(t) {
  const codeChars = (t.match(/[{}();=<>|]/g) ?? []).length;
  if (codeChars / t.length > 0.08) return true;
  return /function\s*\(|=>|==|\bvar\s|\$\(/.test(t);
}

// JS-only ATS pages (e.g. UltiPro) can clear the length gate with script and
// template junk. Weigh by characters, not lines: such pages hide a few huge
// code lines among dozens of one-char bullet/punctuation lines, so a
// line-count majority misses them. Letter-free lines count as unreadable too.
function isMostlyCodeShaped(text) {
  let readable = 0;
  let unreadable = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (isCodeShapedLine(t) || !/[a-zA-Z]/.test(t)) unreadable += t.length;
    else readable += t.length;
  }
  return unreadable >= readable;
}

async function handleImportJob(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  let jobUrl;
  try {
    const { url } = JSON.parse(await readBody(req));
    jobUrl = new URL(String(url ?? ""));
  } catch {
    sendJson(res, 400, { error: "Enter a valid job posting URL." });
    return;
  }

  if (!isPublicHttpUrl(jobUrl)) {
    sendJson(res, 400, { error: "Enter a public http or https job posting URL." });
    return;
  }

  try {
    // Prefer a known ATS JSON API (Workday) since the rendered page is JS-only;
    // fall back to a generic HTML scrape for everything else.
    const workdayApi = workdayCxsUrl(jobUrl);
    if (workdayApi) {
      const workdayText = await importFromWorkday(workdayApi);
      if (workdayText) {
        sendJson(res, 200, { text: workdayText.slice(0, 16_000) });
        return;
      }
    }

    const response = await fetchPublicHtml(jobUrl);

    if (!response.ok) {
      sendJson(res, 400, {
        error: `The job page returned HTTP ${response.status}. Paste the job description text instead.`
      });
      return;
    }

    const html = await response.text();
    const text = linkedInJobText(html) || htmlToText(html);

    if (text.length < 200 || isMostlyCodeShaped(text)) {
      sendJson(res, 400, { error: "Job page did not expose enough readable text. Paste it instead." });
      return;
    }
    sendJson(res, 200, { text: text.slice(0, 16_000) });
  } catch (error) {
    if (error instanceof BlockedHostError) {
      sendJson(res, 400, { error: `${error.message} Paste the job description text instead.` });
      return;
    }
    if (error instanceof DnsError) {
      sendJson(res, 400, { error: "Could not resolve that URL's host. Check the link or paste the text instead." });
      return;
    }
    if (error instanceof FetchTimeoutError) {
      sendJson(res, 504, { error: "Fetching the job page timed out. Paste the job description text instead." });
      return;
    }
    sendJson(res, 400, { error: "This site blocked direct import. Paste the job description text instead." });
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const distRoot = resolve(join(root, "dist"));
  const filePath = resolve(join(distRoot, pathname));

  // Require the dist root PLUS a trailing separator so a sibling like
  // <root>/dist-leak/x can't satisfy a bare startsWith prefix. (URL
  // normalization already collapses `..`, so this is defense in depth.)
  if (filePath !== distRoot && !filePath.startsWith(distRoot + sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    const type =
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml"
      }[extname(filePath)] ?? "application/octet-stream";

    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  } catch {
    const index = await readFile(join(root, "dist", "index.html"));
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(index);
  }
}

// Browser-extension API. These routes are reached cross-origin from a
// chrome-extension:// (or moz-/safari-) page, so they bypass the localhost
// same-origin CSRF guard (dispatched BEFORE it) and instead validate the
// extension Origin scheme directly. They are read-only triage helpers plus a
// one-slot "inbox" used to hand a captured job page to the open app tab; they
// never write resume data or run an AI provider.
const EXTENSION_ORIGIN_SCHEMES = ["chrome-extension://", "moz-extension://", "safari-web-extension://"];

// analyze + import: called cross-origin by the extension popup. Require a
// recognized extension-scheme Origin (a real chrome/moz/safari extension fetch
// always sends one) and reflect that exact Origin back — never a bare "*", and
// never allow an absent Origin, so no same-machine process or web page can
// reach these by omitting the header.
async function handleExtensionRoutes(req, res, pathname) {
  const origin = req.headers.origin;
  if (!origin || !EXTENSION_ORIGIN_SCHEMES.some((scheme) => origin.startsWith(scheme))) {
    sendJson(res, 403, { error: "Forbidden." });
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === "/api/extension/analyze") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Use POST." });
      return;
    }
    let body;
    try {
      body = JSON.parse((await readBody(req, 2_000_000)) || "{}");
    } catch {
      sendJson(res, 400, { error: "Invalid JSON." });
      return;
    }
    const text = typeof body.text === "string" ? body.text : "";
    const url = typeof body.url === "string" ? body.url : "";
    const pageTitle = typeof body.pageTitle === "string" ? body.pageTitle : undefined;
    if (!text.trim() || !url.trim()) {
      sendJson(res, 400, { error: "A job page text and url are required." });
      return;
    }

    const { title, company } = extractJobMeta(text, pageTitle);

    let resumeText = "";
    try {
      const baseResume = await readWorkspaceBaseResume();
      if (baseResume && baseResume.text) {
        resumeText =
          baseResume.kind === "tex"
            ? extractPlainTextFromLatex(baseResume.text)
            : baseResume.text;
      }
    } catch {
      resumeText = "";
    }

    const fit = resumeText.trim().length >= 100 ? quickScore(resumeText, text) : null;

    let previousApp = null;
    try {
      const apps = await readApplications(jobWorkspaceDir);
      const match = findMatchingApplication(url, apps);
      if (match) {
        previousApp = {
          id: match.id,
          status: match.status,
          appliedAt: match.appliedAt || null,
          fitScore: match.tailoredFitScore || match.fitScore || null
        };
      }
    } catch {
      previousApp = null;
    }

    sendJson(res, 200, {
      title: title ?? null,
      company: company ?? null,
      fit,
      previousApp
    });
    return;
  }

  if (pathname === "/api/extension/import") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Use POST." });
      return;
    }
    let body;
    try {
      body = JSON.parse((await readBody(req, 2_000_000)) || "{}");
    } catch {
      sendJson(res, 400, { error: "Invalid JSON." });
      return;
    }
    const text = typeof body.text === "string" ? body.text : "";
    const url = typeof body.url === "string" ? body.url : "";
    if (!text.trim() || !url.trim()) {
      sendJson(res, 400, { error: "A job page text and url are required." });
      return;
    }
    // Last-write-wins: a second import before the app polls overwrites the
    // first. Fine for the one-job-at-a-time personal workflow.
    extensionInbox = { text: text.slice(0, 50_000), url };
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: "Not found." });
}

// Polled same-origin by the app (useExtensionInbox). Returns the pending
// extension import once and clears it. Stays behind the localhost CSRF/Host
// guard (dispatched after it) and sends no CORS header, so a foreign page can
// neither reach nor read it.
async function handleExtensionInbox(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Use GET." });
    return;
  }
  if (extensionInbox === null) {
    sendJson(res, 200, null);
    return;
  }
  const captured = extensionInbox;
  extensionInbox = null;
  sendJson(res, 200, captured);
}

const vite = isProduction
  ? null
  : await createViteServer({
      root,
      appType: "spa",
      server: {
        middlewareMode: true
      }
    });

const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? "/", `http://${req.headers.host}`).pathname;

  // The extension's analyze/import routes are handled BEFORE the localhost CSRF
  // guard: they are called cross-origin from a chrome-extension:// page (an
  // Origin the localhost allowlist would reject) and do their own
  // extension-scheme Origin validation + CORS inside. The inbox route is NOT
  // here — it is polled same-origin by the app itself, so it stays behind the
  // normal CSRF/Host guard below (and never advertises CORS).
  if (pathname === "/api/extension/analyze" || pathname === "/api/extension/import") {
    void handleExtensionRoutes(req, res, pathname);
    return;
  }

  // Same-origin/Host guard for the local API (default 127.0.0.1 mode): a website the
  // user visits must not be able to drive this server cross-origin (CSRF) or read the
  // resume via DNS-rebinding. A rebind/cross-site request carries a foreign Host or
  // Origin. Skipped under an explicit HOST override (LAN access is already an opt-in
  // "no auth, reachable" mode). Static asset requests are unaffected.
  if (pathname.startsWith("/api/") && host === "127.0.0.1") {
    const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
    if (!allowedHosts.has(req.headers.host ?? "")) {
      sendJson(res, 403, { error: "Forbidden host." });
      return;
    }
    if (req.headers.origin) {
      let originHost = ""; // malformed Origin → never matches → blocked
      try {
        originHost = new URL(req.headers.origin).host;
      } catch {
        /* keep sentinel */
      }
      if (!allowedHosts.has(originHost)) {
        sendJson(res, 403, { error: "Cross-origin request blocked." });
        return;
      }
    }
  }

  // Polled same-origin by the app's useExtensionInbox hook; CSRF/Host-guarded
  // above like every other /api/ route (so a foreign page can't drain it).
  if (pathname === "/api/extension/inbox") {
    void handleExtensionInbox(req, res);
    return;
  }

  if (pathname === "/api/polish") {
    void handlePolish(req, res);
    return;
  }

  if (pathname === "/api/application-answers") {
    void handleApplicationAnswers(req, res);
    return;
  }

  if (pathname === "/api/cover-letter") {
    void handleCoverLetter(req, res);
    return;
  }

  if (pathname === "/api/import-job") {
    void handleImportJob(req, res);
    return;
  }

  if (pathname === "/api/workspace") {
    void handleWorkspace(req, res);
    return;
  }

  if (pathname === "/api/workspace/base-resume") {
    void handleWorkspaceBaseResume(req, res);
    return;
  }

  if (pathname === "/api/workspace/base-resume/select") {
    void handleSelectBaseResume(req, res);
    return;
  }

  if (pathname === "/api/workspace/base-resume/restore") {
    void handleRestoreBaseResume(req, res);
    return;
  }

  if (pathname === "/api/import-resume-docx") {
    void handleImportResumeDocx(req, res);
    return;
  }

  if (pathname === "/api/templates") {
    void handleListTemplates(req, res);
    return;
  }

  if (pathname === "/api/render-resume-latex") {
    void handleRenderResumeLatex(req, res);
    return;
  }

  if (pathname === "/api/import-resume-tex") {
    void handleImportResumeTex(req, res);
    return;
  }

  if (pathname === "/api/applications") {
    if (req.method === "GET") {
      void handleListApplications(req, res);
    } else if (req.method === "PUT" || req.method === "POST") {
      void handleSaveApplications(req, res);
    } else {
      sendJson(res, 405, { error: "Use GET or PUT." });
    }
    return;
  }

  const resumeFileMatch = pathname.match(/^\/api\/applications\/([^/]+)\/resume\.(tex|pdf)$/);
  if (resumeFileMatch) {
    const id = decodeRouteSegment(resumeFileMatch[1]);
    if (id === null) {
      sendJson(res, 400, { error: "Invalid application id." });
      return;
    }
    void handleApplicationResumeFile(req, res, id, resumeFileMatch[2]);
    return;
  }

  const resumeSaveMatch = pathname.match(/^\/api\/applications\/([^/]+)\/resume$/);
  if (resumeSaveMatch) {
    const id = decodeRouteSegment(resumeSaveMatch[1]);
    if (id === null) {
      sendJson(res, 400, { error: "Invalid application id." });
      return;
    }
    void handleSaveApplicationResume(req, res, id);
    return;
  }

  if (vite) {
    vite.middlewares(req, res, () => {
      res.writeHead(404);
      res.end("Not found");
    });
    return;
  }

  void serveStatic(req, res);
});

server.listen(port, host, () => {
  console.log(`RoleFit AI running at http://localhost:${port}/`);
  if (host === "0.0.0.0") {
    console.log("⚠️  Bound to 0.0.0.0 (HOST override): reachable from your local network. This app has no auth.");
  }
  console.log(`Default AI provider: ${getDefaultProvider()}`);
  console.log(`Default AI model: ${getDefaultModel() || "(CLI default)"}`);
});
