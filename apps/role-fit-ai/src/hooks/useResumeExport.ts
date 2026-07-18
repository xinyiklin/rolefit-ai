import { useState } from "react";

import type { DocStyle } from "@typeset/engine/lib/documentStyle.ts";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import { serializeResumeFile } from "@typeset/engine/lib/resumeFile.ts";
import { toTypesetSchema } from "@typeset/engine/typeset/schema.ts";
import { downloadBlob } from "@typeset/engine/lib/download.ts";
import type { PolishedResume } from "../resumeEngine";
import { buildResumeFileName, extractApplicantName, sanitizeFileBase } from "../lib/downloads";
import { inferCompanyFromUrl } from "../lib/jobTarget";

type UseResumeExportArgs = {
  result: PolishedResume | null;
  // The current cover letter — single owner, from polish OR on-demand
  // generation (App's useCoverLetter state). The Copy button reads this.
  coverLetterText?: string;
  // The structured editor model. PDF export, preview, and the .resume save all
  // work from this — the owned typeset engine and the .resume file format are
  // both fully client-side.
  editedResume: ResumeData | null;
  // The current resume text as shown in the editor (structured model serialized),
  // falling back to the raw polish output. Used for the file-name heuristic
  // when no structured model exists yet.
  currentResumeText: string;
  // Editable document identity from the Resume tab. It is the canonical
  // default base name for both PDF and `.resume` saves.
  documentTitle: string;
  jobUrl: string;
  // Resolver for the employer name used in download file names. Returns the
  // distilled/tracked company (the same value the application is saved with) so
  // the file name matches the application; falls back to the URL-derived guess
  // only when this is empty. A thunk so the distiller runs lazily at save time.
  resolveJobCompany?: () => string;
  resumeText: string;
  // The shared formatting toolbar's document values. The engine consumes them
  // directly.
  docStyle: DocStyle;
  // The status line is owned by App because several non-export handlers
  // (polish, workspace, track) also write to it; this hook reports export
  // progress through it.
  setExportStatus: (value: string) => void;
};

function pdfExportFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : "";
  if (/font|Unknown font format/i.test(detail)) {
    return "PDF export failed. The bundled document fonts could not be loaded. Try again.";
  }
  if (/dynamically imported module|Outdated Optimize Dep/i.test(detail)) {
    return "PDF export failed. The export tools could not be loaded. Refresh RoleFit AI and try again.";
  }
  return "PDF export failed. Try again.";
}

// Owns the resume export surface: engine PDF render/preview and the `.resume`
// save, plus the per-action status/flag state those buttons read.
export function useResumeExport({
  result,
  coverLetterText,
  editedResume,
  currentResumeText,
  documentTitle,
  jobUrl,
  resolveJobCompany,
  resumeText,
  docStyle,
  setExportStatus
}: UseResumeExportArgs) {
  // Typeset the structured resume with the shared engine and serialize to PDF
  // bytes — fully client-side. Dynamic imports keep pdf-lib + the engine out
  // of the main bundle until first use.
  async function renderEnginePdfBytes(): Promise<Uint8Array> {
    if (!editedResume) throw new Error("No structured resume to typeset.");
    const [{ layoutResume }, { emitPdf, fetchFontBytes }] = await Promise.all([
      import("@typeset/engine/typeset/layout.ts"),
      import("@typeset/engine/typeset/pdf/emit.ts")
    ]);
    const schema = toTypesetSchema(editedResume);
    const document = layoutResume(schema, docStyle);
    // `fetchFontBytes` receives a host-owned public asset base. Vite rewrites
    // CSS font URLs for sub-path deployments, but it cannot rewrite a runtime
    // string inside the PDF emitter. Respect BASE_URL explicitly so the Pages
    // demo fetches /rolefit-ai/fonts/* while local development still uses
    // /fonts/*.
    const publicBase = import.meta.env.BASE_URL.replace(/\/$/, "");
    const fonts = await fetchFontBytes(document, `${publicBase}/fonts`);
    return emitPdf(document, fonts, {
      title: documentTitle.trim() || (schema.name ? `${schema.name} Resume` : "Resume")
    });
  }

  const [coverCopied, setCoverCopied] = useState(false);
  const [isRenderingPdf, setIsRenderingPdf] = useState(false);

  // Clear stale download confirmations when a new polish starts. The shared
  // exportStatus line is reset by App alongside this call.
  function resetStatuses() {
    setCoverCopied(false);
  }

  async function handleCopyCoverLetter() {
    const letter = coverLetterText;
    if (!letter) return;
    try {
      await navigator.clipboard.writeText(letter);
      setCoverCopied(true);
      window.setTimeout(() => setCoverCopied(false), 1800);
    } catch {
      setExportStatus("Copy failed. Select the cover letter text and copy it manually.");
    }
  }

  // The editable document title is the canonical default for both save formats.
  // The export menu still offers it in a rename dialog; `overrideBase` carries
  // that one-off choice and is sanitized before the extension is re-attached.
  function resumeDownloadName(ext: string, overrideBase?: string): string {
    if (overrideBase && overrideBase.trim()) {
      return `${sanitizeFileBase(overrideBase)}.${ext}`;
    }
    if (documentTitle.trim()) return `${sanitizeFileBase(documentTitle)}.${ext}`;
    // Compatibility fallback for a missing title: prefer the distilled/tracked
    // company (matches the saved application), then the URL-derived guess.
    const company = (resolveJobCompany?.() || "").trim() || inferCompanyFromUrl(jobUrl);
    // Prefer the structured model's name; fall back to scanning the serialized
    // text only when there is no structured model yet (text-only polish result).
    const applicant =
      (editedResume?.name ?? "").replace(/<\/?[a-z]+>/gi, "").trim() ||
      extractApplicantName(currentResumeText || resumeText);
    return buildResumeFileName(applicant, company, ext);
  }

  // "PDF": typeset by the shared engine, serialized client-side (D014).
  async function handleDownloadPdf(overrideBase?: string) {
    // The engine typesets the structured model only; say so rather than
    // no-opping (canExport also allows a text-only polish result).
    if (!editedResume) {
      setExportStatus("Load a resume into the editor to export a PDF.");
      return;
    }
    setIsRenderingPdf(true);
    setExportStatus("Typesetting PDF…");
    try {
      const bytes = await renderEnginePdfBytes();
      const fileName = resumeDownloadName("pdf", overrideBase);
      downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), fileName);
      setExportStatus(`Downloaded ${fileName}.`);
    } catch (error) {
      setExportStatus(pdfExportFailureMessage(error));
    } finally {
      setIsRenderingPdf(false);
    }
  }

  // Download the current resume as a `.resume` file: a lossless, re-loadable
  // JSON save of the structured editor model — fully client-side, no server
  // route (same as the PDF path).
  function handleDownloadResume(overrideBase?: string) {
    if (!editedResume) {
      setExportStatus("Load a resume into the editor to save a .resume file.");
      return;
    }
    const fileName = resumeDownloadName("resume", overrideBase);
    downloadBlob(new Blob([serializeResumeFile(editedResume, docStyle)], { type: "application/json" }), fileName);
    setExportStatus(`Saved ${fileName}.`);
  }

  // Render the CURRENT resume to artifacts for pipeline tracking: the
  // engine-typeset PDF as base64. Returns null when there is nothing to
  // render or the PDF emit fails, so a failed render never blocks tracking.
  async function getResumeArtifacts(): Promise<{ pdfBase64: string | null; fileName: string } | null> {
    if (!result && !editedResume) return null;
    let pdfBase64: string | null = null;
    try {
      const bytes = await renderEnginePdfBytes();
      pdfBase64 = await blobToBase64(new Blob([bytes as BlobPart]));
    } catch {
      return null;
    }
    return { pdfBase64, fileName: resumeDownloadName("pdf") };
  }

  return {
    coverCopied,
    isRenderingPdf,
    resetStatuses,
    handleCopyCoverLetter,
    resumeDownloadName,
    handleDownloadPdf,
    handleDownloadResume,
    getResumeArtifacts
  };
}

// Blob → bare base64 (no data: prefix), for posting the compiled PDF to the
// application-resume save endpoint.
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not encode PDF."));
    reader.readAsDataURL(blob);
  });
}
