import { useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { EXPORT_META } from "./ExportRail";
import { useModalFocus } from "@typeset/editor/hooks/useModalFocus.ts";

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
  busy: boolean;
  error?: string;
  onDownload: (fileBaseName: string) => void | Promise<void>;
  onSkip: () => void;
  onApplyOnly: () => void | Promise<void>;
};

export function ApplyDownloadDialog({
  label,
  defaultFileBaseName,
  busy,
  error,
  onDownload,
  onSkip,
  onApplyOnly
}: ApplyDownloadDialogProps) {
  const [fileName, setFileName] = useState(defaultFileBaseName);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const handleModalKeyDown = useModalFocus({
    active: true,
    containerRef: formRef,
    initialFocusRef: nameInputRef,
    onClose: busy ? () => undefined : onSkip,
    selectInitialText: true
  });

  return (
    <div
      className="rename-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Apply and download resume"
      onKeyDown={handleModalKeyDown}
    >
      <div
        className="rename-dialog__backdrop"
        aria-hidden="true"
        onMouseDown={busy ? undefined : onSkip}
      />
      <form
        ref={formRef}
        className="rename-dialog__card apply-download"
        tabIndex={-1}
        onSubmit={(event) => {
          event.preventDefault();
          void onDownload(fileName.trim());
        }}
      >
        <button type="button" className="apply-download__close" onClick={onSkip} aria-label="Cancel" title="Cancel without applying" disabled={busy}>
          <X size={14} />
        </button>
        <p className="rename-dialog__hint">
          Apply to <strong>{label}</strong>. Name the file before downloading the PDF.
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
              aria-label="File name, without extension"
              spellCheck={false}
              disabled={busy}
            />
            <span className="rename-dialog__ext" aria-hidden="true">
              .{EXPORT_META["pdf-engine"].ext}
            </span>
          </span>
          <span className="rename-dialog__hint apply-download__name-hint">
            Rename it before saving if you like. The extension is added for you.
          </span>
        </label>

        {error ? <p className="rename-dialog__error" role="alert">{error}</p> : null}

        <footer className="rename-dialog__actions">
          <button type="button" className="ghost-button is-compact" onClick={() => void onApplyOnly()} title="Apply without downloading" disabled={busy}>
            {busy ? "Saving…" : "Apply only"}
          </button>
          <button type="submit" className="primary-button is-compact" disabled={busy}>
            <Download size={13} aria-hidden="true" />
            {busy ? "Saving…" : "Apply & download"}
          </button>
        </footer>
      </form>
    </div>
  );
}
