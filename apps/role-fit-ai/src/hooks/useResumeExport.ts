import { useState } from "react";

import type { DocStyle } from "./useDocStyle";
import type { PolishedResume } from "../resumeEngine";
import { buildResumeFileName, downloadBlob, extractApplicantName, sanitizeFileBase } from "../lib/downloads";
import { inferCompanyFromUrl } from "../lib/jobTarget";
import { toTemplateSchema, type ResumeData } from "../lib/resumeData";
import { serializeResumeFile } from "../lib/resumeFile";

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
  jobUrl: string;
  // Resolver for the employer name used in download file names. Returns the
  // distilled/tracked company (the same value the application is saved with) so
  // the file name matches the application; falls back to the URL-derived guess
  // only when this is empty. A thunk so the distiller runs lazily at save time.
  resolveJobCompany?: () => string;
  resumeText: string;
  // The editor's Format-menu values. The engine consumes them directly.
  docStyle: DocStyle;
  // The status line is owned by App because several non-export handlers
  // (polish, workspace, track) also write to it; this hook reports export
  // progress through it.
  setExportStatus: (value: string) => void;
};

// Owns the resume export surface: engine PDF render/preview and the `.resume`
// save, plus the per-action status/flag state those buttons read.
export function useResumeExport({
  result,
  coverLetterText,
  editedResume,
  currentResumeText,
  jobUrl,
  resolveJobCompany,
  resumeText,
  docStyle,
  setExportStatus
}: UseResumeExportArgs) {
  // Typeset the structured resume with the owned engine and serialize to PDF
  // bytes — fully client-side. Dynamic imports keep pdf-lib + the engine out
  // of the main bundle until first use.
  async function renderEnginePdfBytes(): Promise<Uint8Array> {
    if (!editedResume) throw new Error("No structured resume to typeset.");
    const [{ layoutResume }, { emitPdf, fetchFontBytes }] = await Promise.all([
      import("../typeset/layout.ts"),
      import("../typeset/pdf/emit.ts")
    ]);
    const fonts = await fetchFontBytes();
    const schema = toTemplateSchema(editedResume);
    return emitPdf(layoutResume(schema, docStyle), fonts, {
      title: schema.name ? `${schema.name} — Resume` : "Resume"
    });
  }

  const [coverCopied, setCoverCopied] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState("");
  const [isRenderingPdf, setIsRenderingPdf] = useState(false);

  // Clear stale download confirmations when a new polish starts. The shared
  // exportStatus line is reset by App alongside this call.
  function resetStatuses() {
    setCoverCopied(false);
    setDownloadStatus("");
  }

  async function handleCopyCoverLetter() {
    const letter = coverLetterText;
    if (!letter) return;
    try {
      await navigator.clipboard.writeText(letter);
      setCoverCopied(true);
      window.setTimeout(() => setCoverCopied(false), 1800);
      setDownloadStatus("");
    } catch {
      setDownloadStatus("Clipboard is unavailable in this browser context. Select the cover letter text and copy it manually.");
    }
  }

  // Name downloads after the applicant (+ company when a job link gives one):
  // Xinyi_Lin_Stripe_Resume.pdf → Xinyi_Lin_Resume.pdf → Resume.pdf. The export
  // rail offers this as the pre-filled default in a rename dialog; when the user
  // edits it, `overrideBase` carries their chosen base name (extension excluded)
  // and we sanitize + re-attach the correct extension so they cannot break it.
  function resumeDownloadName(ext: string, overrideBase?: string): string {
    if (overrideBase && overrideBase.trim()) {
      return `${sanitizeFileBase(overrideBase)}.${ext}`;
    }
    // Prefer the distilled/tracked company (matches the saved application) and
    // fall back to the URL-derived guess only when it is empty.
    const company = (resolveJobCompany?.() || "").trim() || inferCompanyFromUrl(jobUrl);
    // Prefer the structured model's name; fall back to scanning the serialized
    // text only when there is no structured model yet (text-only polish result).
    const applicant =
      (editedResume?.name ?? "").replace(/<\/?[a-z]+>/gi, "").trim() ||
      extractApplicantName(currentResumeText || resumeText);
    return buildResumeFileName(applicant, company, ext);
  }

  // "PDF": typeset by the owned engine, serialized client-side (D014).
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
      setExportStatus(error instanceof Error ? `PDF export failed: ${error.message}` : "PDF export failed.");
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
    downloadBlob(new Blob([serializeResumeFile(editedResume)], { type: "application/json" }), fileName);
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
    downloadStatus,
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
