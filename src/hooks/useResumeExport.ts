import { useState } from "react";

import type { PolishedResume } from "../resumeEngine";
import type { SourceDocx } from "../sections/shared";
import type { RenderPdfResult, Template } from "./useTemplates";
import { buildResumeFileName, downloadBlob, extractApplicantName } from "../lib/downloads";
import { inferCompanyFromUrl } from "../lib/jobTarget";
import { looksLikeLatex } from "../lib/resumeFormat";

type RenderTex = (resumeText: string, templateId?: string, options?: { rawTex?: boolean }) => Promise<string>;
type RenderPdf = (resumeText: string, templateId?: string, options?: { rawTex?: boolean }) => Promise<RenderPdfResult>;

type UseResumeExportArgs = {
  result: PolishedResume | null;
  sourceDocx: SourceDocx | null;
  jobUrl: string;
  resumeText: string;
  resumeSourceFormat: string;
  selectedTemplateId: string;
  selectedTemplate: Template | null;
  renderTex: RenderTex;
  renderPdf: RenderPdf;
  tectonic: { available: boolean };
  // The LaTeX/download status line is owned by App because several non-export
  // handlers (polish, workspace, track) also write to it; this hook reports
  // export progress through it.
  setTexStatus: (value: string) => void;
};

// Owns the resume export surface: copy, clean-PDF print, DOCX export, LaTeX
// .tex / PDF render, and Open-in-Overleaf, plus the per-action status/flag
// state those buttons read. Pulled out of App.tsx so the orchestrator stays
// focused on workflow state; behavior is unchanged from the inline handlers.
export function useResumeExport({
  result,
  sourceDocx,
  jobUrl,
  resumeText,
  resumeSourceFormat,
  selectedTemplateId,
  selectedTemplate,
  renderTex,
  renderPdf,
  tectonic,
  setTexStatus
}: UseResumeExportArgs) {
  const [copied, setCopied] = useState(false);
  const [coverCopied, setCoverCopied] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState("");
  const [isDownloadingTex, setIsDownloadingTex] = useState(false);
  const [isRenderingLatexPdf, setIsRenderingLatexPdf] = useState(false);
  const [isOpeningOverleaf, setIsOpeningOverleaf] = useState(false);

  // Clear stale copy/download confirmations when a new polish starts. The shared
  // texStatus line is reset by App alongside this call.
  function resetStatuses() {
    setCopied(false);
    setCoverCopied(false);
    setDownloadStatus("");
  }

  async function handleCopy() {
    if (!result?.polishedText) return;
    try {
      await navigator.clipboard.writeText(result.polishedText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      setDownloadStatus("");
    } catch {
      setDownloadStatus("Clipboard is unavailable in this browser context. Select the resume text and copy it manually.");
    }
  }

  async function handleCopyCoverLetter() {
    if (!result?.coverLetterText) return;
    try {
      await navigator.clipboard.writeText(result.coverLetterText);
      setCoverCopied(true);
      window.setTimeout(() => setCoverCopied(false), 1800);
      setDownloadStatus("");
    } catch {
      setDownloadStatus("Clipboard is unavailable in this browser context. Select the cover letter text and copy it manually.");
    }
  }

  // Name downloads after the applicant (+ company when a job link gives one):
  // Xinyi_Lin_Stripe_Resume.pdf → Xinyi_Lin_Resume.pdf → Resume.pdf.
  function resumeDownloadName(ext: string): string {
    return buildResumeFileName(
      extractApplicantName(result?.polishedText || resumeText),
      inferCompanyFromUrl(jobUrl),
      ext
    );
  }

  // "PDF · clean": print the HTML resume document (the same one shown in the
  // Resume tab) so the browser's Save as PDF yields selectable, ATS-readable
  // text. document.title seeds the suggested filename, restored after printing.
  function handlePrintResume() {
    if (!result?.polishedText) return;
    const fileName = resumeDownloadName("pdf").replace(/\.pdf$/i, "");
    const previousTitle = document.title;
    document.title = fileName;
    window.addEventListener("afterprint", () => { document.title = previousTitle; }, { once: true });
    window.print();
    setDownloadStatus("Opened the print dialog — choose “Save as PDF” (uncheck “Headers and footers” for a clean page).");
  }

  async function handleDownloadDocx() {
    if (!result || !sourceDocx) return;
    try {
      const response = await fetch("/api/export-resume-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docxBase64: sourceDocx.base64, polishedText: result.polishedText })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "DOCX export failed.");
      const byteCharacters = window.atob(String(data.docxBase64 ?? ""));
      const bytes = new Uint8Array(byteCharacters.length);
      for (let index = 0; index < byteCharacters.length; index += 1) {
        bytes[index] = byteCharacters.charCodeAt(index);
      }
      const fileName = resumeDownloadName("docx");
      downloadBlob(
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        }),
        fileName
      );
      const appended = Number(data.appendedParagraphs ?? 0);
      setDownloadStatus(
        appended
          ? `Downloaded ${fileName}. Added ${appended} extra paragraph${appended === 1 ? "" : "s"} because the polished text was longer than the source layout.`
          : `Downloaded ${fileName} using the uploaded DOCX structure.`
      );
    } catch (error) {
      setDownloadStatus(
        error instanceof Error ? error.message : "DOCX export failed. Use the PDF export or copy the polished text."
      );
    }
  }

  async function handleDownloadTex() {
    if (!result) return;
    // In-place: the polished text already is the user's edited .tex — download it
    // directly so the original LaTeX layout is kept (no template re-render).
    if (resumeSourceFormat === "LaTeX" && looksLikeLatex(result.polishedText)) {
      const fileName = resumeDownloadName("tex");
      downloadBlob(new Blob([result.polishedText], { type: "application/x-tex" }), fileName);
      setTexStatus(`Downloaded ${fileName} — your original LaTeX, edited in place. Paste into Overleaf or your LaTeX editor.`);
      return;
    }
    setIsDownloadingTex(true);
    setTexStatus("Rendering LaTeX source...");
    try {
      const tex = await renderTex(result.polishedText, selectedTemplateId);
      const templateLabel = selectedTemplate?.name ?? selectedTemplateId;
      const fileName = resumeDownloadName("tex");
      downloadBlob(new Blob([tex], { type: "application/x-tex" }), fileName);
      setTexStatus(
        `Downloaded ${fileName} using the ${templateLabel} template. Paste into Overleaf or your local LaTeX editor.`
      );
    } catch (error) {
      setTexStatus(error instanceof Error ? error.message : "TEX render failed.");
    } finally {
      setIsDownloadingTex(false);
    }
  }

  async function handleDownloadLatexPdf() {
    if (!result) return;
    if (!tectonic.available) {
      setTexStatus(
        "Tectonic is not installed. Install with `brew install tectonic` to enable in-app LaTeX PDF rendering."
      );
      return;
    }
    const latexInPlace = resumeSourceFormat === "LaTeX" && looksLikeLatex(result.polishedText);
    setIsRenderingLatexPdf(true);
    setTexStatus(
      latexInPlace ? "Compiling your edited LaTeX → PDF with Tectonic..." : "Compiling LaTeX → PDF with Tectonic..."
    );
    try {
      const outcome = latexInPlace
        ? await renderPdf(result.polishedText, undefined, { rawTex: true })
        : await renderPdf(result.polishedText, selectedTemplateId);
      if ("error" in outcome) {
        setTexStatus(
          outcome.missingTectonic
            ? "Tectonic is not installed. Install with `brew install tectonic` to enable in-app LaTeX PDF rendering."
            : `LaTeX PDF compile failed: ${outcome.error}`
        );
        return;
      }
      const fileName = resumeDownloadName("pdf");
      downloadBlob(outcome.pdf, fileName);
      setTexStatus(
        latexInPlace
          ? `Downloaded ${fileName} compiled from your edited LaTeX via Tectonic (in place, no template).`
          : `Downloaded ${fileName} rendered via Tectonic + ${selectedTemplate?.name ?? selectedTemplateId}.`
      );
    } catch (error) {
      setTexStatus(error instanceof Error ? error.message : "LaTeX PDF render failed.");
    } finally {
      setIsRenderingLatexPdf(false);
    }
  }

  async function handleOpenInOverleaf() {
    if (!result) return;
    const overleafWindow = window.open("about:blank", "_blank");
    if (!overleafWindow) {
      setTexStatus("Popup blocked. Allow popups for localhost:5181 and try again.");
      return;
    }

    const latexInPlace = resumeSourceFormat === "LaTeX" && looksLikeLatex(result.polishedText);
    setIsOpeningOverleaf(true);
    setTexStatus("Preparing .tex for Overleaf...");
    try {
      const tex = latexInPlace ? result.polishedText : await renderTex(result.polishedText, selectedTemplateId);
      const templateLabel = latexInPlace ? "Original LaTeX" : selectedTemplate?.name ?? "Resume";
      const snipName = `Polished resume — ${templateLabel}`;

      // Build the auto-submitting form via DOM APIs so correctness never depends
      // on a hand-rolled HTML escaper. Values are assigned, not interpolated.
      const doc = overleafWindow.document;
      doc.title = "Opening in Overleaf…";
      doc.body.style.cssText = "font-family:system-ui;color:#555;padding:24px";
      doc.body.textContent = "Sending polished resume to Overleaf…";

      const form = doc.createElement("form");
      form.action = "https://www.overleaf.com/docs";
      form.method = "POST";
      form.enctype = "application/x-www-form-urlencoded";

      const snip = doc.createElement("textarea");
      snip.name = "snip";
      snip.value = tex;

      const snipNameInput = doc.createElement("input");
      snipNameInput.type = "hidden";
      snipNameInput.name = "snip_name";
      snipNameInput.value = snipName;

      const engineInput = doc.createElement("input");
      engineInput.type = "hidden";
      engineInput.name = "engine";
      engineInput.value = "pdflatex";

      form.append(snip, snipNameInput, engineInput);
      doc.body.append(form);
      form.submit();

      setTexStatus(`Opened ${templateLabel} in Overleaf. Hit Compile in the new tab to generate the PDF.`);
    } catch (error) {
      overleafWindow.close();
      setTexStatus(error instanceof Error ? error.message : "Open in Overleaf failed.");
    } finally {
      setIsOpeningOverleaf(false);
    }
  }

  return {
    copied,
    coverCopied,
    downloadStatus,
    isDownloadingTex,
    isRenderingLatexPdf,
    isOpeningOverleaf,
    resetStatuses,
    handleCopy,
    handleCopyCoverLetter,
    resumeDownloadName,
    handlePrintResume,
    handleDownloadDocx,
    handleDownloadTex,
    handleDownloadLatexPdf,
    handleOpenInOverleaf
  };
}
