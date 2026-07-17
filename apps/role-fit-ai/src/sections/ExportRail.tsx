import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Download, FileJson, X } from "lucide-react";

// The owned engine's PDF is the only file-export format (D014). Kept as a named
// union so EXPORT_META / the rename target stay self-documenting.
type ExportFormat = "pdf-engine";

// File-saving exports route through a rename dialog: the system names the file
// first (`defaultFileBaseName`), the user can edit it, then confirm. Preview is
// not a file-save, so it bypasses it.
export const EXPORT_META: Record<ExportFormat, { ext: string; label: string }> = {
  "pdf-engine": { ext: "pdf", label: "PDF" }
};

// The `.resume` save isn't part of ExportFormat (PDF is the only file-export
// format) — it's a plain client-side save button, so its rename-dialog metadata
// lives locally here.
const RESUME_EXT = "resume";
const RESUME_LABEL = ".resume";

type RenameTarget = ExportFormat | "resume";

type ExportMenuProps = {
  // True once a resume is exportable: a structured editor model exists (loaded
  // base / upload) or a polish produced text. Exports do not require an AI run.
  canExport: boolean;
  // System-proposed file name (extension excluded) — pre-fills the rename
  // dialog. e.g. "Xinyi_Lin_Stripe_Resume".
  defaultFileBaseName: string;
  isRenderingPdf: boolean;
  exportStatus: string;
  downloadStatus: string;
  // The download handlers accept the user's chosen base name (extension
  // excluded); when omitted they fall back to the system name.
  onDownloadPdf: (fileBaseName?: string) => void | Promise<void>;
  onDownloadResume: (fileBaseName?: string) => void;
};

export function ExportMenu({
  canExport,
  defaultFileBaseName,
  isRenderingPdf,
  exportStatus,
  downloadStatus,
  onDownloadPdf,
  onDownloadResume
}: ExportMenuProps) {
  // Rename-at-save: which export was requested, plus the in-flight file name.
  const [renameFormat, setRenameFormat] = useState<RenameTarget | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Open the rename dialog for a save action, pre-filled with the system name.
  function requestExport(format: RenameTarget) {
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
    if (format === "pdf-engine") onDownloadPdf(base);
    else onDownloadResume(base);
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

  const renameLabel = renameFormat === "resume" ? RESUME_LABEL : renameFormat ? EXPORT_META[renameFormat].label : "";
  const renameExt = renameFormat === "resume" ? RESUME_EXT : renameFormat ? EXPORT_META[renameFormat].ext : "";

  return (
    <div className="export-menu" ref={menuRef} aria-label="Export">
      <button
        className="secondary-button is-compact export-menu__trigger"
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title="Export the resume as PDF, or save it as a re-loadable .resume file"
      >
        <Download size={14} aria-hidden="true" />
        <span>Export</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>

      {isOpen ? (
        <div className="export-menu__popover" role="menu" aria-label="Export options">
          <div className="export-menu__actions">
            {/* PDF — typeset by the built-in engine, fully client-side (D014). */}
            <button
              className="ghost-button is-compact pdf-action pdf-action--canonical"
              type="button"
              disabled={!canExport || isRenderingPdf}
              onClick={() => requestExport("pdf-engine")}
              title={
                isRenderingPdf
                  ? "Typesetting PDF, please wait"
                  : canExport
                  ? "Download the resume as PDF (typeset in-app; searchable text, clickable links)"
                  : "Load a resume to enable exports"
              }
            >
              <Download size={14} aria-hidden="true" />
              <span>{isRenderingPdf ? "Typesetting…" : "PDF"}</span>
            </button>

            {/* .resume — a lossless JSON save of the structured editor model,
                re-loadable from the Resume menu's upload. */}
            <button
              className="ghost-button is-compact"
              type="button"
              disabled={!canExport}
              onClick={() => requestExport("resume")}
              title={
                canExport
                  ? "Download resume data (.resume) — re-loadable save"
                  : "Load a resume to enable exports"
              }
            >
              <FileJson size={14} aria-hidden="true" />
              <span>{RESUME_LABEL}</span>
            </button>
          </div>

          {exportStatus || downloadStatus ? (
            <div className="export-menu__status" role="status">
              {exportStatus ? <span>{exportStatus}</span> : null}
              {exportStatus && downloadStatus ? <span className="sep">·</span> : null}
              {downloadStatus ? <span>{downloadStatus}</span> : null}
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
              <span>Save {renameLabel}</span>
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
                  .{renameExt}
                </span>
              </span>
            </label>
            <p className="rename-dialog__hint">
              The system named this for you — rename it before saving if you like.
            </p>
            <footer className="rename-dialog__actions">
              <button type="button" className="ghost-button is-compact" onClick={cancelRename}>
                <X size={12} aria-hidden="true" />
                Cancel
              </button>
              <button type="submit" className="secondary-button is-compact">
                <Check size={12} aria-hidden="true" />
                Save
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </div>
  );
}
