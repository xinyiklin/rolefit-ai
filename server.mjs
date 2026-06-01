import { createServer } from "node:http";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { createServer as createViteServer } from "vite";
import { getDefaultModel, handlePolish } from "./server/ai/polish.mjs";
import {
  listTemplates,
  renderResumeTex,
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
  applyTextToDocumentXml,
  assertSafeZipEntries,
  base64ToBuffer,
  bufferToBase64,
  execFileAsync,
  extractDocxResume,
  withUnpackedDocx
} from "./server/docx.mjs";
import { FetchTimeoutError, readBody, sendJson } from "./server/http.mjs";
import { BlockedHostError, DnsError, fetchPublicHtml, isPublicHttpUrl } from "./server/network.mjs";

const root = process.cwd();
const isProduction = process.env.NODE_ENV === "production";
const jobWorkspaceDir = join(root, "job-search-workspace");
const baseResumeCandidates = [
  "base-resume.docx",
  "base-resume.tex",
  "base-resume.txt",
  "base-resume.md",
  "base-resume.csv"
];

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

async function ensureJobWorkspace() {
  await mkdir(jobWorkspaceDir, { recursive: true });
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

async function readWorkspaceBaseResume() {
  for (const fileName of baseResumeCandidates) {
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
        kind: extension.replace(".", "") || "text",
        text
      };
    } catch {
      // Try the next supported base-resume file.
    }
  }

  return { exists: false };
}

// Keep exactly one base resume on disk, but never hard-delete: move every known
// variant into job-search-workspace/.trash/ with a timestamp so a removed or
// replaced base resume is always recoverable. Missing files are skipped.
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
      files: await readWorkspaceFiles()
    });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Workspace check failed." });
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

    // Preserve the LaTeX source under a .tex name so it loads back as "LaTeX",
    // not flattened to plain text. Everything else stores as base-resume.txt.
    const isTex = extension === ".tex";
    const targetName = isTex ? "base-resume.tex" : "base-resume.txt";
    await clearBaseResumeFiles();
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
      files: await readWorkspaceFiles()
    });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Base resume save failed." });
  }
}

async function handleExportResumeDocx(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  try {
    const { docxBase64, polishedText } = JSON.parse(await readBody(req));
    const result = await withUnpackedDocx(docxBase64, async ({ workspace, unpackedPath }) => {
      const documentPath = join(unpackedPath, "word", "document.xml");
      const documentXml = await readFile(documentPath, "utf8");
      const applied = applyTextToDocumentXml(documentXml, polishedText);
      const outputPath = join(workspace, "polished.docx");

      await writeFile(documentPath, applied.documentXml);
      // Confine the re-zip to the unpack dir, then re-verify the resulting entry
      // names so a crafted source archive can't smuggle traversal paths through.
      await execFileAsync("zip", ["-qr", outputPath, "."], { cwd: unpackedPath });
      const { stdout: repackListing } = await execFileAsync("unzip", ["-Z1", outputPath]);
      assertSafeZipEntries(repackListing);

      return {
        docxBase64: bufferToBase64(await readFile(outputPath)),
        replacedParagraphs: applied.replacedParagraphs,
        appendedParagraphs: applied.appendedParagraphs
      };
    });

    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "DOCX export failed." });
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

    if (!resumeText.trim()) {
      sendJson(res, 400, { error: "Resume text is empty." });
      return;
    }

    const { tex, templateId: resolvedTemplateId } = rawTex
      ? { tex: resumeText, templateId: "raw" }
      : renderResumeTex({ resumeText, templateId });

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

    const text = htmlToText(await response.text());

    if (text.length < 200) {
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
  const filePath = resolve(join(root, "dist", pathname));

  if (!filePath.startsWith(resolve(join(root, "dist")))) {
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

  if (pathname === "/api/polish") {
    void handlePolish(req, res);
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

  if (pathname === "/api/import-resume-docx") {
    void handleImportResumeDocx(req, res);
    return;
  }

  if (pathname === "/api/export-resume-docx") {
    void handleExportResumeDocx(req, res);
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

  if (vite) {
    vite.middlewares(req, res, () => {
      res.writeHead(404);
      res.end("Not found");
    });
    return;
  }

  void serveStatic(req, res);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`RoleFit AI running at http://localhost:${port}/`);
  console.log(`Default AI model: ${getDefaultModel()}`);
});
