// Public entry for the LaTeX subsystem. server.mjs imports from here.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseResumeText, extractPlainTextFromLatex } from "./parseResumeText.mjs";
import { listTemplates, getTemplate, defaultTemplateId } from "./templates/index.mjs";

export { parseResumeText, extractPlainTextFromLatex, listTemplates, getTemplate, defaultTemplateId };

// --- Render -----------------------------------------------------------

export function renderResumeTex({ resumeText, templateId }) {
  const template = getTemplate(templateId) ?? getTemplate(defaultTemplateId);
  if (!template) {
    throw new Error(`No LaTeX template registered for id "${templateId}".`);
  }
  const schema = parseResumeText(resumeText);
  if (!schema.name && !schema.sections.length) {
    throw new Error("Resume text is empty — nothing to render.");
  }
  const tex = template.render(schema);
  return { templateId: template.id, tex, schema };
}

// --- Tectonic detection (cached at boot, optional) --------------------

let tectonicCheck = null;

export function checkTectonicAvailability() {
  if (tectonicCheck) return tectonicCheck;
  tectonicCheck = new Promise((resolve) => {
    const child = spawn("tectonic", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout?.on("data", (chunk) => { out += chunk.toString(); });
    child.on("error", () => resolve({ available: false, version: null }));
    child.on("close", (code) => {
      if (code === 0) {
        const version = out.split("\n")[0]?.trim() || "unknown";
        resolve({ available: true, version });
      } else {
        resolve({ available: false, version: null });
      }
    });
  });
  return tectonicCheck;
}

// --- Optional compile via Tectonic (no-op if unavailable) -------------

export async function compileTexToPdf(tex) {
  const status = await checkTectonicAvailability();
  if (!status.available) {
    const error = new Error("Tectonic is not installed. Install it with `brew install tectonic` to enable in-app PDF rendering.");
    error.code = "TECTONIC_MISSING";
    throw error;
  }

  const workdir = await mkdtemp(join(tmpdir(), "role-fit-tex-"));
  const inputPath = join(workdir, "resume.tex");
  const outputPath = join(workdir, "resume.pdf");

  try {
    await writeFile(inputPath, tex, "utf8");
    await new Promise((resolve, reject) => {
      const child = spawn("tectonic", ["-X", "compile", "--keep-logs", "--outdir", workdir, inputPath], {
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stderr = "";
      child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Tectonic exited with code ${code}: ${stderr.slice(-400)}`));
      });
    });
    const pdfBuffer = await readFile(outputPath);
    return pdfBuffer;
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}
