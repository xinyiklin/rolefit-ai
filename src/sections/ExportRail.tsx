import { useState } from "react";
import { Clipboard, ClipboardList, Download, ExternalLink, FileCode2, X } from "lucide-react";
import type { PolishedResume } from "../resumeEngine";
import type { TectonicStatus, Template } from "../hooks/useTemplates";

type SourceDocxFlag = boolean;

type ExportRailProps = {
  templates: Template[];
  templatesError: string;
  selectedTemplateId: string;
  setSelectedTemplateId: (id: string) => void;
  selectedTemplate: Template | null;
  tectonic: TectonicStatus;
  result: PolishedResume | null;
  jobUrl: string;
  jobDescription: string;
  hasSourceDocx: SourceDocxFlag;
  copied: boolean;
  isDownloadingTex: boolean;
  isOpeningOverleaf: boolean;
  isRenderingLatexPdf: boolean;
  texStatus: string;
  downloadStatus: string;
  onCopy: () => void | Promise<void>;
  onDownloadTex: () => void | Promise<void>;
  onOpenInOverleaf: () => void | Promise<void>;
  onDownloadLatexPdf: () => void | Promise<void>;
  onDownloadPdf: () => void;
  onDownloadDocx: () => void | Promise<void>;
  onTrack: (resumeUsed: "tailored" | "base") => void;
};

export function ExportRail({
  templates,
  templatesError,
  selectedTemplateId,
  setSelectedTemplateId,
  selectedTemplate,
  tectonic,
  result,
  jobUrl,
  jobDescription,
  hasSourceDocx,
  copied,
  isDownloadingTex,
  isOpeningOverleaf,
  isRenderingLatexPdf,
  texStatus,
  downloadStatus,
  onCopy,
  onDownloadTex,
  onOpenInOverleaf,
  onDownloadLatexPdf,
  onDownloadPdf,
  onDownloadDocx,
  onTrack
}: ExportRailProps) {
  // When a tailored draft exists, Track asks which resume actually went out
  // (the AI may judge the base already strong, so people sometimes send it).
  const [askResumeUsed, setAskResumeUsed] = useState(false);
  const aiSuggestsAsIs = Boolean(result?.strictReview?.recommendation?.applyAsIs);

  function handleTrackClick() {
    if (result?.polishedText) {
      setAskResumeUsed(true);
    } else {
      onTrack("base");
    }
  }

  function chooseResume(resumeUsed: "tailored" | "base") {
    setAskResumeUsed(false);
    onTrack(resumeUsed);
  }

  return (
    <footer className="export-rail" aria-label="Render & export">
      <div className="export-rail__template">
        <label htmlFor="latex-template">
          <FileCode2 size={14} aria-hidden="true" />
          <span>Template</span>
        </label>
        <select
          id="latex-template"
          value={selectedTemplateId}
          onChange={(event) => setSelectedTemplateId(event.target.value)}
          disabled={!templates.length}
        >
          {templates.length === 0 ? (
            <option value="">Loading…</option>
          ) : (
            templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))
          )}
        </select>
        {selectedTemplate ? <small className="export-rail__hint">{selectedTemplate.description}</small> : null}
        {templatesError ? <small className="export-rail__hint warn">{templatesError}</small> : null}
      </div>

      <div className="export-rail__actions">
        <button
          className="ghost-button is-compact"
          type="button"
          disabled={!result}
          onClick={onCopy}
          title="Copy polished resume text"
        >
          <Clipboard size={14} aria-hidden="true" />
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
        <button
          className="ghost-button is-compact"
          type="button"
          disabled={!result || isDownloadingTex}
          onClick={onDownloadTex}
          title="Download polished resume as LaTeX source for the selected template"
        >
          <FileCode2 size={14} aria-hidden="true" />
          <span>{isDownloadingTex ? "Rendering…" : ".tex"}</span>
        </button>
        <button
          className="ghost-button is-compact"
          type="button"
          disabled={!result || isOpeningOverleaf}
          onClick={onOpenInOverleaf}
          title="Open the .tex in a new Overleaf tab — compile there with one click"
        >
          <ExternalLink size={14} aria-hidden="true" />
          <span>{isOpeningOverleaf ? "Opening…" : "Overleaf"}</span>
        </button>
        <button
          className="ghost-button is-compact"
          type="button"
          disabled={!result || !tectonic.available || isRenderingLatexPdf}
          onClick={onDownloadLatexPdf}
          title={
            tectonic.available
              ? `Render PDF via Tectonic + ${selectedTemplate?.name ?? "template"}`
              : "Install Tectonic to render LaTeX PDFs locally (brew install tectonic)"
          }
        >
          <Download size={14} aria-hidden="true" />
          <span>{isRenderingLatexPdf ? "Compiling…" : "PDF · LaTeX"}</span>
        </button>
        <button
          className="ghost-button is-compact"
          type="button"
          disabled={!result}
          onClick={onDownloadPdf}
          title="Download with the clean ATS template (no LaTeX needed)"
        >
          <Download size={14} aria-hidden="true" />
          <span>PDF · clean</span>
        </button>
        {hasSourceDocx ? (
          <button
            className="ghost-button is-compact"
            type="button"
            disabled={!result}
            onClick={onDownloadDocx}
            title="Download DOCX with uploaded formatting preserved"
          >
            <Download size={14} aria-hidden="true" />
            <span>DOCX</span>
          </button>
        ) : null}
        {askResumeUsed ? (
          <div className="track-ask" role="group" aria-label="Which resume did you send?">
            <span className="track-ask__label">
              Which resume did you send?
              {aiSuggestsAsIs ? <em> AI said your base is already a strong fit.</em> : null}
            </span>
            <button className="ghost-button is-compact" type="button" onClick={() => chooseResume("tailored")}>
              Tailored
            </button>
            <button className="ghost-button is-compact" type="button" onClick={() => chooseResume("base")}>
              Original / base
            </button>
            <button
              className="ghost-button is-compact"
              type="button"
              onClick={() => setAskResumeUsed(false)}
              aria-label="Cancel"
              title="Cancel"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <button
            className="ghost-button is-compact"
            type="button"
            disabled={!jobUrl.trim() && !jobDescription.trim()}
            onClick={handleTrackClick}
            title="Save this role to the pipeline tracker on disk"
          >
            <ClipboardList size={14} aria-hidden="true" />
            <span>Track</span>
          </button>
        )}
      </div>

      {texStatus || downloadStatus ? (
        <div className="export-rail__status" role="status">
          {texStatus ? <span>{texStatus}</span> : null}
          {texStatus && downloadStatus ? <span className="sep">·</span> : null}
          {downloadStatus ? <span>{downloadStatus}</span> : null}
        </div>
      ) : null}
      {!tectonic.available ? (
        <div className="export-rail__tip">
          <span>
            No local LaTeX. Use <strong>Overleaf</strong>, or <code>brew install tectonic</code> for in-app PDF.
          </span>
        </div>
      ) : null}
    </footer>
  );
}
