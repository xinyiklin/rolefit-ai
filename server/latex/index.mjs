// Public entry for the LaTeX subsystem. server.mjs imports from here.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseResumeText, extractPlainTextFromLatex } from "./parseResumeText.mjs";
import { listTemplates, getTemplate, defaultTemplateId } from "./templates/index.mjs";

export { parseResumeText, extractPlainTextFromLatex, listTemplates, getTemplate, defaultTemplateId };

// --- Render -----------------------------------------------------------

export function renderResumeTex({ resumeText, templateId, docStyle }) {
  const template = getTemplate(templateId) ?? getTemplate(defaultTemplateId);
  if (!template) {
    throw new Error(`No LaTeX template registered for id "${templateId}".`);
  }
  const schema = parseResumeText(resumeText);
  if (!schema.name && !schema.sections.length) {
    throw new Error("Resume text is empty — nothing to render.");
  }
  const tex = template.render(schema, docStyle);
  return { templateId: template.id, tex, schema };
}

// Render straight from the structured resume schema the interactive editor sends
// (Compile Preview), skipping the lossy text → schema parse. Defensively normalizes
// the client payload so templates that map over items/bullets never crash on
// malformed input.
export function renderResumeTexFromSchema({ schema, templateId, docStyle }) {
  const template = getTemplate(templateId) ?? getTemplate(defaultTemplateId);
  if (!template) {
    throw new Error(`No LaTeX template registered for id "${templateId}".`);
  }
  const normalized = normalizeSchema(schema);
  if (!normalized.name && !normalized.sections.length) {
    throw new Error("Resume data is empty — nothing to render.");
  }
  const tex = template.render(normalized, docStyle);
  return { templateId: template.id, tex, schema: normalized };
}

function asString(value) {
  return typeof value === "string" ? value : "";
}

function normalizeSchema(schema) {
  const source = schema && typeof schema === "object" ? schema : {};
  return {
    name: asString(source.name),
    contact: Array.isArray(source.contact) ? source.contact.filter((c) => typeof c === "string") : [],
    sections: Array.isArray(source.sections) ? source.sections.map(normalizeSection).filter(Boolean) : []
  };
}

function normalizeSection(section) {
  if (!section || typeof section !== "object") return null;
  const rawType = asString(section.type);
  // Preserve the editor's explicit type so templates classify by it instead of
  // re-inferring from the heading; unknown/absent stays undefined (text-parsed
  // schemas fall back to heading-based classification in the templates).
  const type = rawType === "skills" || rawType === "summary" || rawType === "standard" ? rawType : undefined;
  return {
    heading: asString(section.heading),
    ...(type ? { type } : {}),
    items: Array.isArray(section.items)
      ? section.items.map(type === "skills" ? normalizeSkillItem : normalizeItem).filter(Boolean)
      : []
  };
}

function normalizeSkillItem(item) {
  if (!item || typeof item !== "object") return null;
  const label = asString(item.titleLeft ?? item.title).trim();
  const skills = asString(item.subtitleLeft ?? item.subtitle).trim();
  const row = label && skills ? `${label}: ${skills}` : label || skills;
  const bullets = Array.isArray(item.bullets) ? item.bullets.filter((b) => typeof b === "string") : [];
  return {
    title: "",
    subtitle: "",
    meta: "",
    location: "",
    bullets: [row, ...bullets].filter(Boolean)
  };
}

function normalizeItem(item) {
  if (!item || typeof item !== "object") return null;
  return {
    title: asString(item.title ?? item.titleLeft),
    subtitle: asString(item.subtitle ?? item.subtitleLeft),
    meta: asString(item.meta ?? item.titleRight),
    location: asString(item.location ?? item.subtitleRight),
    bullets: Array.isArray(item.bullets) ? item.bullets.filter((b) => typeof b === "string") : []
  };
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

// Tectonic runs the XeTeX engine, which lacks pdfTeX-only primitives that
// common resume templates (e.g. Jake's) use — `\input{glyphtounicode}` and
// `\pdfgentounicode`. Define them as harmless no-ops so those documents compile
// unchanged. The shims are inert under pdfTeX too (the primitives already
// exist), and we only apply them to the file handed to Tectonic — never to the
// .tex a user downloads.
function makeXetexSafe(tex) {
  const shim =
    "\n% Tectonic/XeTeX compatibility shims for pdfTeX-only primitives\n" +
    "\\ifdefined\\pdfgentounicode\\else\\newcount\\pdfgentounicode\\fi\n" +
    "\\providecommand\\pdfglyphtounicode[2]{}\n";
  const match = tex.match(/\\documentclass[^\n]*\n/);
  if (!match) return tex;
  const insertAt = match.index + match[0].length;
  return tex.slice(0, insertAt) + shim + tex.slice(insertAt);
}

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
    await writeFile(inputPath, makeXetexSafe(tex), "utf8");
    await new Promise((resolve, reject) => {
      // --untrusted disables shell-escape AND restricts \input/\openin/\openout
      // to the input's directory, so a crafted resume (esp. the client rawTex
      // path) can't read local files like .env into the compiled PDF.
      // No --keep-logs: it would persist a resume.log (resume PII) in the temp dir;
      // diagnostics still stream to stderr (captured below for the error message).
      const child = spawn("tectonic", ["-X", "compile", "--untrusted", "--outdir", workdir, inputPath], {
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stderr = "";
      let killed = false;
      // Wall-clock guard: a non-terminating macro (esp. via the rawTex path) could
      // otherwise pin a CPU core indefinitely. SIGTERM, then escalate to SIGKILL.
      const timer = setTimeout(() => {
        killed = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2_000).unref?.();
        const error = new Error("Tectonic timed out after 60s — the LaTeX may contain a non-terminating macro.");
        error.code = "COMPILE_TIMEOUT";
        reject(error);
      }, 60_000);
      timer.unref?.();
      child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (killed) return; // already rejected by the timeout
        if (code === 0) resolve();
        // Redact the absolute temp workdir from the message that reaches the client
        // UI (rendered verbatim); keep the TeX diagnostic itself intact.
        else reject(new Error(`Tectonic exited with code ${code}: ${stderr.slice(-400).split(workdir).join("")}`));
      });
    });
    const pdfBuffer = await readFile(outputPath);
    return pdfBuffer;
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}
