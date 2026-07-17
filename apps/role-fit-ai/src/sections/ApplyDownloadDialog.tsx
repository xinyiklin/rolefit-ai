import { useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { EXPORT_META } from "./ExportRail";

// Pre-apply confirmation: name the file, then Apply+Download the PDF in one
// step. "Apply only" saves the application without starting a download. The
// close button (×) cancels without applying. PDF is the only Apply-download
// format (the `.resume` save is a separate button, not part of this concept),
// so there is no format picker here.
type ApplyDownloadDialogProps = {
  // Application title, for context in the header ("Stripe — Software Engineer").
  label: string;
  // System-proposed file name (extension excluded) — pre-fills the name field.
  defaultFileBaseName: string;
  onDownload: (fileBaseName: string) => void;
  onSkip: () => void;
  onApplyOnly: () => void;
};

export function ApplyDownloadDialog({
  label,
  defaultFileBaseName,
  onDownload,
  onSkip,
  onApplyOnly
}: ApplyDownloadDialogProps) {
  const [fileName, setFileName] = useState(defaultFileBaseName);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Focus + select the file name on open so renaming is one move.
  useEffect(() => {
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onSkip();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onSkip]);


  return (
    <div className="rename-dialog" role="dialog" aria-modal="true" aria-label="Apply and download resume">
      <div className="rename-dialog__backdrop" onClick={onSkip} />
      <form
        className="rename-dialog__card apply-download"
        onSubmit={(event) => {
          event.preventDefault();
          onDownload(fileName.trim());
        }}
      >
        <button type="button" className="apply-download__close" onClick={onSkip} aria-label="Cancel" title="Cancel without applying">
          <X size={14} />
        </button>
        <p className="rename-dialog__hint">
          Apply to <strong>{label}</strong>. Name the file — it downloads as PDF.
        </p>

        <label className="rename-dialog__field apply-download__name">
          <span className="apply-download__field-label">File name</span>
          <span className="rename-dialog__input-wrap">
            <input
              ref={nameInputRef}
              className="rename-dialog__input"
              type="text"
              value={fileName}
              onChange={(event) => setFileName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") onSkip();
              }}
              aria-label="File name, without extension"
              spellCheck={false}
            />
            <span className="rename-dialog__ext" aria-hidden="true">
              .{EXPORT_META["pdf-engine"].ext}
            </span>
          </span>
          <span className="rename-dialog__hint apply-download__name-hint">
            Rename it before saving if you like — the extension is added for you.
          </span>
        </label>

        <footer className="rename-dialog__actions">
          <button type="button" className="ghost-button is-compact" onClick={onApplyOnly} title="Apply without downloading">
            Apply only
          </button>
          <button type="submit" className="primary-button is-compact">
            <Download size={13} aria-hidden="true" />
            Apply &amp; download
          </button>
        </footer>
      </form>
    </div>
  );
}
