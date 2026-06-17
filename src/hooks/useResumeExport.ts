import { useState } from "react";

import type { DocStyle } from "./useDocStyle";
import type { PolishedResume } from "../resumeEngine";
import type { RenderPdfResult, Template } from "./useTemplates";
import { buildResumeFileName, downloadBlob, extractApplicantName, sanitizeFileBase } from "../lib/downloads";
import { inferCompanyFromUrl } from "../lib/jobTarget";
import { toTemplateSchema, type ResumeData, type ResumeTemplateSchema } from "../lib/resumeData";

type RenderTex = (resumeText: string, templateId?: string, options?: { rawTex?: boolean; docStyle?: DocStyle }) => Promise<string>;
type RenderPdf = (resumeText: string, templateId?: string, options?: { rawTex?: boolean; docStyle?: DocStyle }) => Promise<RenderPdfResult>;
type RenderTexFromSchema = (schema: ResumeTemplateSchema, templateId?: string, options?: { docStyle?: DocStyle }) => Promise<string>;
type RenderPdfFromSchema = (schema: ResumeTemplateSchema, templateId?: string, options?: { docStyle?: DocStyle }) => Promise<RenderPdfResult>;

type UseResumeExportArgs = {
  result: PolishedResume | null;
  // The current cover letter — single owner, from polish OR on-demand
  // generation (App's useCoverLetter state). The Copy button reads this.
  coverLetterText?: string;
  // The structured editor model. When present, LaTeX exports (.tex / PDF·LaTeX)
  // render straight from it through the template — the SAME faithful path the
  // on-screen compile preview uses — instead of the lossy serialize→reparse text
  // round-trip, so the download matches the preview byte-for-structure.
  editedResume: ResumeData | null;
  // The current resume text as shown in the editor (structured model serialized),
  // falling back to the raw polish output. Clean-print operates on THIS; it is
  // also the LaTeX fallback when no structured model exists.
  currentResumeText: string;
  jobUrl: string;
  // Resolver for the employer name used in download file names. Returns the
  // distilled/tracked company (the same value the application is saved with) so
  // the file name matches the application; falls back to the URL-derived guess
  // only when this is empty. A thunk so the distiller runs lazily at save time.
  resolveJobCompany?: () => string;
  resumeText: string;
  selectedTemplateId: string;
  selectedTemplate: Template | null;
  renderTex: RenderTex;
  renderPdf: RenderPdf;
  renderTexFromSchema: RenderTexFromSchema;
  renderPdfFromSchema: RenderPdfFromSchema;
  // The editor's Format-menu values. Forwarded to the LaTeX renderer so the
  // compiled PDF mirrors the on-screen typography (spacing + leading).
  docStyle: DocStyle;
  tectonic: { available: boolean };
  // The LaTeX/download status line is owned by App because several non-export
  // handlers (polish, workspace, track) also write to it; this hook reports
  // export progress through it.
  setTexStatus: (value: string) => void;
};

// Owns the resume export surface: clean-PDF print, LaTeX .tex / PDF render,
// and in-app PDF preview, plus the per-action status/flag state those buttons
// read. Pulled out of App.tsx so the orchestrator stays focused on workflow
// state; behavior is unchanged from the inline handlers.
export function useResumeExport({
  result,
  coverLetterText,
  editedResume,
  currentResumeText,
  jobUrl,
  resolveJobCompany,
  resumeText,
  selectedTemplateId,
  selectedTemplate,
  renderTex,
  renderPdf,
  renderTexFromSchema,
  renderPdfFromSchema,
  docStyle,
  tectonic,
  setTexStatus
}: UseResumeExportArgs) {
  // Render the CURRENT resume to LaTeX/PDF. With a structured model, go straight
  // through the template (faithful — matches the compile preview); otherwise fall
  // back to the serialize→reparse text path.
  function renderCurrentTex(): Promise<string> {
    return editedResume
      ? renderTexFromSchema(toTemplateSchema(editedResume), selectedTemplateId, { docStyle })
      : renderTex(currentResumeText, selectedTemplateId, { docStyle });
  }
  function renderCurrentPdf(): Promise<RenderPdfResult> {
    return editedResume
      ? renderPdfFromSchema(toTemplateSchema(editedResume), selectedTemplateId, { docStyle })
      : renderPdf(currentResumeText, selectedTemplateId, { docStyle });
  }

  const [coverCopied, setCoverCopied] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState("");
  const [isDownloadingTex, setIsDownloadingTex] = useState(false);
  const [isRenderingLatexPdf, setIsRenderingLatexPdf] = useState(false);

  // In-app PDF preview state (Tectonic compile → blob URL → overlay).
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewPdfUrl, setPreviewPdfUrl] = useState("");

  // Clear stale download confirmations when a new polish starts. The shared
  // texStatus line is reset by App alongside this call.
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
    return buildResumeFileName(
      extractApplicantName(currentResumeText || resumeText),
      company,
      ext
    );
  }

  // "PDF · clean": print the off-screen ResumePrintLayer — the read-only .rdx-*
  // mirror of the structured resume (text-parsed fallback when no model exists) — so
  // the browser's Save as PDF yields selectable, ATS-readable text. document.title
  // seeds the suggested filename, restored after printing.
  function handlePrintResume(overrideBase?: string) {
    if (!currentResumeText) return;
    const fileName = resumeDownloadName("pdf", overrideBase).replace(/\.pdf$/i, "");
    const previousTitle = document.title;
    document.title = fileName;
    window.addEventListener("afterprint", () => { document.title = previousTitle; }, { once: true });
    window.print();
    setDownloadStatus("Opened the print dialog — choose “Save as PDF” (uncheck “Headers and footers” for a clean page).");
  }

  async function handleDownloadTex(overrideBase?: string) {
    // Exports need a renderable resume, not an AI result: the structured editor
    // is the source of truth, so .tex is always rendered from the current
    // resume data through the selected template.
    if (!result && !editedResume) return;
    setIsDownloadingTex(true);
    setTexStatus("Rendering LaTeX source…");
    try {
      const tex = await renderCurrentTex();
      const templateLabel = selectedTemplate?.name ?? selectedTemplateId;
      const fileName = resumeDownloadName("tex", overrideBase);
      downloadBlob(new Blob([tex], { type: "application/x-tex" }), fileName);
      setTexStatus(
        `Downloaded ${fileName} using the ${templateLabel} template.`
      );
    } catch (error) {
      setTexStatus(error instanceof Error ? error.message : "TEX render failed.");
    } finally {
      setIsDownloadingTex(false);
    }
  }

  async function handleDownloadLatexPdf(overrideBase?: string) {
    if (!result && !editedResume) return;
    if (!tectonic.available) {
      setTexStatus(
        "Tectonic is not installed. Install with `brew install tectonic` to enable in-app LaTeX PDF rendering."
      );
      return;
    }
    setIsRenderingLatexPdf(true);
    setTexStatus("Compiling LaTeX → PDF with Tectonic…");
    try {
      const outcome = await renderCurrentPdf();
      if ("error" in outcome) {
        setTexStatus(
          outcome.missingTectonic
            ? "Tectonic is not installed. Install with `brew install tectonic` to enable in-app LaTeX PDF rendering."
            : `LaTeX PDF compile failed: ${outcome.error}`
        );
        return;
      }
      const fileName = resumeDownloadName("pdf", overrideBase);
      downloadBlob(outcome.pdf, fileName);
      setTexStatus(`Downloaded ${fileName} rendered via Tectonic + ${selectedTemplate?.name ?? selectedTemplateId}.`);
    } catch (error) {
      setTexStatus(error instanceof Error ? error.message : "LaTeX PDF render failed.");
    } finally {
      setIsRenderingLatexPdf(false);
    }
  }

  async function handlePreview() {
    if (!result && !editedResume) return;
    if (!tectonic.available) {
      setTexStatus(
        "Tectonic is not installed. Install with `brew install tectonic` to enable PDF preview."
      );
      return;
    }
    // Revoke any previous blob URL before creating a new one.
    if (previewPdfUrl) {
      URL.revokeObjectURL(previewPdfUrl);
      setPreviewPdfUrl("");
    }
    setIsPreviewOpen(true);
    setIsPreviewLoading(true);
    setPreviewError("");
    try {
      const outcome = await renderCurrentPdf();
      if ("error" in outcome) {
        setPreviewError(
          outcome.missingTectonic
            ? "Tectonic is not installed. Install with `brew install tectonic`."
            : outcome.error
        );
        return;
      }
      const url = URL.createObjectURL(outcome.pdf);
      setPreviewPdfUrl(url);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "PDF preview failed.");
    } finally {
      setIsPreviewLoading(false);
    }
  }

  function handleClosePreview() {
    setIsPreviewOpen(false);
    if (previewPdfUrl) {
      URL.revokeObjectURL(previewPdfUrl);
      setPreviewPdfUrl("");
    }
    setPreviewError("");
  }

  // Render the CURRENT resume to artifacts for pipeline tracking: the .tex source
  // (always, deterministic from the model/template) plus the compiled PDF as
  // base64 when Tectonic is available. Returns null when there is nothing to
  // render; degrades to tex-only when the PDF compile is unavailable or fails,
  // so tracking never blocks on a missing Tectonic install.
  async function getResumeArtifacts(): Promise<
    { tex: string; pdfBase64: string | null; fileName: string; templateId: string } | null
  > {
    if (!result && !editedResume) return null;
    let tex = "";
    try {
      tex = await renderCurrentTex();
    } catch {
      return null;
    }
    if (!tex.trim()) return null;
    let pdfBase64: string | null = null;
    if (tectonic.available) {
      try {
        const outcome = await renderCurrentPdf();
        if (!("error" in outcome)) {
          pdfBase64 = await blobToBase64(outcome.pdf);
        }
      } catch {
        // Keep tex-only; a failed compile must not abort tracking.
      }
    }
    return { tex, pdfBase64, fileName: resumeDownloadName("pdf"), templateId: selectedTemplateId };
  }

  return {
    coverCopied,
    downloadStatus,
    isDownloadingTex,
    isRenderingLatexPdf,
    isPreviewOpen,
    isPreviewLoading,
    previewError,
    previewPdfUrl,
    resetStatuses,
    handleCopyCoverLetter,
    resumeDownloadName,
    handlePrintResume,
    handleDownloadTex,
    handleDownloadLatexPdf,
    handlePreview,
    handleClosePreview,
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
