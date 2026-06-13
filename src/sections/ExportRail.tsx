import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Download, Eye, FileCode2, X } from "lucide-react";
import type { TectonicStatus, Template } from "../hooks/useTemplates";
import type { ExportFormat } from "../lib/exportPrefs";

// File-saving exports route through a rename dialog: the system names the file
// first (`defaultFileBaseName`), the user can edit it, then confirm. Preview is
// not a file-save, so it bypasses it. `pdf-clean` prints through the browser's
// own Save-as-PDF dialog; we still collect a name so document.title (which seeds
// that dialog's suggested filename) reflects the user's choice.
// `ExportFormat` is shared with the post-Apply download prompt (see exportPrefs).
export const EXPORT_META: Record<ExportFormat, { ext: string; label: string }> = {
  "pdf-latex": { ext: "pdf", label: "PDF (LaTeX)" },
  "pdf-clean": { ext: "pdf", label: "PDF (clean)" },
  tex: { ext: "tex", label: "LaTeX source" }
};

type ExportMenuProps = {
  templates: Template[];
  templatesError: string;
  selectedTemplateId: string;
  setSelectedTemplateId: (id: string) => void;
  selectedTemplate: Template | null;
  tectonic: TectonicStatus;
  // True once a resume is exportable: a structured editor model exists (loaded
  // base / upload) or a polish produced text. Exports do not require an AI run.
  canExport: boolean;
  // System-proposed file name (extension excluded) — pre-fills the rename
  // dialog. e.g. "Xinyi_Lin_Stripe_Resume".
  defaultFileBaseName: string;
  isDownloadingTex: boolean;
  isRenderingLatexPdf: boolean;
  isPreviewLoading: boolean;
  texStatus: string;
  downloadStatus: string;
  // The download handlers accept the user's chosen base name (extension
  // excluded); when omitted they fall back to the system name.
  onDownloadTex: (fileBaseName?: string) => void | Promise<void>;
  onDownloadLatexPdf: (fileBaseName?: string) => void | Promise<void>;
  onPreview: () => void | Promise<void>;
  onPrintResume: (fileBaseName?: string) => void;
};

export function ExportMenu({
  templates,
  templatesError,
  selectedTemplateId,
  setSelectedTemplateId,
  selectedTemplate,
  tectonic,
  canExport,
  defaultFileBaseName,
  isDownloadingTex,
  isRenderingLatexPdf,
  isPreviewLoading,
  texStatus,
  downloadStatus,
  onDownloadTex,
  onDownloadLatexPdf,
  onPreview,
  onPrintResume
}: ExportMenuProps) {
  // Rename-at-save: which export was requested, plus the in-flight file name.
  const [renameFormat, setRenameFormat] = useState<ExportFormat | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Open the rename dialog for a save action, pre-filled with the system name.
  function requestExport(format: ExportFormat) {
    setRenameValue(defaultFileBaseName);
    setRenameFormat(format);
    setIsOpen(false);
  }

  function cancelRename() {
    setRenameFormat(null);
  }

  function confirmRename() {
    const format = renameFormat;
    if (!format) return;
    // Pass the raw value through; the export hook sanitizes and re-attaches the
    // extension. An empty field falls back to the system name there.
    const base = renameValue.trim() || undefined;
    setRenameFormat(null);
    if (format === "pdf-latex") onDownloadLatexPdf(base);
    else if (format === "pdf-clean") onPrintResume(base);
    else if (format === "tex") onDownloadTex(base);
  }

  // Focus + select the file name when the dialog opens so renaming is one move.
  useEffect(() => {
    if (renameFormat && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renameFormat]);

  useEffect(() => {
    if (!isOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="export-menu" ref={menuRef} aria-label="Render and export">
      <button
        className="ghost-button is-compact"
        type="button"
        disabled={!canExport || !tectonic.available || isPreviewLoading}
        onClick={onPreview}
        title={
          isPreviewLoading
            ? "Compiling PDF, please wait"
            : !tectonic.available
            ? "Install Tectonic to preview LaTeX PDFs locally (brew install tectonic)"
            : canExport
            ? `Preview PDF via Tectonic + ${selectedTemplate?.name ?? "template"}`
            : "Load a resume to enable exports"
        }
      >
        <Eye size={14} aria-hidden="true" />
        <span>{isPreviewLoading ? "Compiling…" : "Preview"}</span>
      </button>
      <button
        className="secondary-button is-compact export-menu__trigger"
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Export"
        title="Export"
      >
        <Download size={14} aria-hidden="true" />
        <ChevronDown size={13} aria-hidden="true" />
      </button>

      {isOpen ? (
        <div className="export-menu__popover" role="menu" aria-label="Export options">
          {templates.length > 1 ? (
            <label className="export-menu__template" htmlFor="latex-template">
              <span>
                <FileCode2 size={14} aria-hidden="true" />
                Template
              </span>
              <select
                id="latex-template"
                value={selectedTemplateId}
                onChange={(event) => setSelectedTemplateId(event.target.value)}
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
              {selectedTemplate ? <small>{selectedTemplate.description}</small> : null}
            </label>
          ) : null}

          {templatesError ? <small className="export-menu__hint warn">{templatesError}</small> : null}

          <div className="export-menu__actions">
            {/* Utility export */}
            <button
              className="ghost-button is-compact"
              type="button"
              disabled={!canExport || isDownloadingTex}
              onClick={() => requestExport("tex")}
              title={
                isDownloadingTex
                  ? "Rendering LaTeX source, please wait"
                  : canExport
                  ? "Download the current resume as LaTeX source for the selected template"
                  : "Load a resume to enable exports"
              }
            >
              <FileCode2 size={14} aria-hidden="true" />
              <span>{isDownloadingTex ? "Rendering…" : ".tex"}</span>
            </button>

            {/* PDF destination actions */}
            <button
              className="ghost-button is-compact pdf-action pdf-action--canonical"
              type="button"
              disabled={!canExport || !tectonic.available || isRenderingLatexPdf}
              onClick={() => requestExport("pdf-latex")}
              title={
                isRenderingLatexPdf
                  ? "Compiling PDF via Tectonic, please wait"
                  : !tectonic.available
                  ? "Install Tectonic to render LaTeX PDFs locally (brew install tectonic)"
                  : canExport
                  ? `Render PDF via Tectonic + ${selectedTemplate?.name ?? "template"}`
                  : "Load a resume to enable exports"
              }
            >
              <Download size={14} aria-hidden="true" />
              <span>{isRenderingLatexPdf ? "Compiling…" : "PDF · LaTeX"}</span>
            </button>
            <button
              className="ghost-button is-compact pdf-action"
              type="button"
              disabled={!canExport}
              onClick={() => requestExport("pdf-clean")}
              title={
                canExport
                  ? "Opens your browser's print dialog — choose Save as PDF (no LaTeX needed)"
                  : "Load a resume to enable exports"
              }
            >
              <Download size={14} aria-hidden="true" />
              <span>PDF · clean</span>
            </button>
          </div>

          {texStatus || downloadStatus ? (
            <div className="export-menu__status" role="status">
              {texStatus ? <span>{texStatus}</span> : null}
              {texStatus && downloadStatus ? <span className="sep">·</span> : null}
              {downloadStatus ? <span>{downloadStatus}</span> : null}
            </div>
          ) : null}
          {!tectonic.available ? (
            <div className="export-menu__tip">
              <span>
                Install <code>brew install tectonic</code> for in-app PDF preview and LaTeX export.
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {renameFormat ? (
        <div className="rename-dialog" role="dialog" aria-modal="true" aria-label="Name your download">
          <div className="rename-dialog__backdrop" onClick={cancelRename} />
          <form
            className="rename-dialog__card"
            onSubmit={(event) => {
              event.preventDefault();
              confirmRename();
            }}
          >
            <header className="rename-dialog__head">
              <Download size={14} aria-hidden="true" />
              <span>Save {EXPORT_META[renameFormat].label}</span>
            </header>
            <label className="rename-dialog__field">
              <span className="rename-dialog__label">File name</span>
              <span className="rename-dialog__input-wrap">
                <input
                  ref={renameInputRef}
                  className="rename-dialog__input"
                  type="text"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") cancelRename();
                  }}
                  aria-label="File name, without extension"
                  spellCheck={false}
                />
                <span className="rename-dialog__ext" aria-hidden="true">
                  .{EXPORT_META[renameFormat].ext}
                </span>
              </span>
            </label>
            <p className="rename-dialog__hint">
              {renameFormat === "pdf-clean"
                ? "Your browser's Save-as-PDF dialog opens next, pre-filled with this name."
                : "The system named this for you — rename it before saving if you like."}
            </p>
            <footer className="rename-dialog__actions">
              <button type="button" className="ghost-button is-compact" onClick={cancelRename}>
                <X size={12} aria-hidden="true" />
                Cancel
              </button>
              <button type="submit" className="secondary-button is-compact">
                <Check size={12} aria-hidden="true" />
                {renameFormat === "pdf-clean" ? "Continue" : "Save"}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </div>
  );
}
