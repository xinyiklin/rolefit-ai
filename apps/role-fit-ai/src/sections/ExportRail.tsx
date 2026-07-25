import { useEffect, useRef, useState } from "react";
import { Check, Download, X } from "lucide-react";
import { useModalFocus } from "@typeset/editor/hooks/useModalFocus.ts";

// The owned engine's PDF is the only file-export format (D014). Kept as a named
// union so EXPORT_META / the rename target stay self-documenting.
type ExportFormat = "pdf-engine";

// File-saving exports route through a rename dialog: the system names the file
// first (`defaultFileBaseName`), the user can edit it, then confirm. Preview is
// not a file-save, so it bypasses it.
export const EXPORT_META: Record<ExportFormat, { ext: string; label: string }> = {
  "pdf-engine": { ext: "pdf", label: "PDF" }
};

type ExportMenuProps = {
  // System-proposed file name (extension excluded) — pre-fills the rename
  // dialog. e.g. "Xinyi_Lin_Stripe_Resume". The Save menu's PDF row owns the
  // exportable/rendering gating, so neither flag is needed here.
  defaultFileBaseName: string;
  // Controlled request from the Save menu's PDF row. The trigger used to live
  // here as its own toolbar button; PDF is a save, so it moved into Save and this
  // component kept only the dialog, its focus trap, and the status feedback.
  promptOpen: boolean;
  onPromptOpenChange: (open: boolean) => void;
  status?: string;
  statusIsError?: boolean;
  onDismissStatus?: () => void;
  // The download handlers accept the user's chosen base name (extension
  // excluded); when omitted they fall back to the system name.
  onDownloadPdf: (fileBaseName?: string) => void | Promise<void>;
};

export function ExportMenu({
  defaultFileBaseName,
  promptOpen,
  onPromptOpenChange,
  status,
  statusIsError = false,
  onDismissStatus,
  onDownloadPdf
}: ExportMenuProps) {
  const renameFormat: ExportFormat | null = promptOpen ? "pdf-engine" : null;
  const [renameValue, setRenameValue] = useState("");
  // Seed the field each time the prompt opens; the dialog itself is unmounted
  // while closed, so this cannot fight a value the user is typing.
  useEffect(() => {
    if (promptOpen) setRenameValue(defaultFileBaseName);
  }, [promptOpen, defaultFileBaseName]);
  const renameCardRef = useRef<HTMLFormElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const handleRenameKeyDown = useModalFocus({
    active: renameFormat !== null,
    containerRef: renameCardRef,
    initialFocusRef: renameInputRef,
    onClose: cancelRename,
    selectInitialText: true
  });

  function cancelRename() {
    onPromptOpenChange(false);
  }

  function confirmRename() {
    const format = renameFormat;
    if (!format) return;
    // Pass the raw value through; the export hook sanitizes and re-attaches the
    // extension. An empty field falls back to the system name there.
    const base = renameValue.trim() || undefined;
    onPromptOpenChange(false);
    onDownloadPdf(base);
  }

  const renameLabel = renameFormat ? EXPORT_META[renameFormat].label : "";
  const renameExt = renameFormat ? EXPORT_META[renameFormat].ext : "";

  // Nothing to show: with the trigger moved into the Save menu, an idle export
  // is an empty wrapper that still consumes a flex gap in the action bar.
  if (!renameFormat && !status) return null;

  return (
    <div className="export-menu" aria-label="Export PDF">
      {status && !renameFormat ? (
        <div
          className={`export-menu__feedback${statusIsError ? " export-menu__feedback--error" : ""}`}
          role={statusIsError ? "alert" : "status"}
          aria-live={statusIsError ? "assertive" : "polite"}
        >
          <span>{status}</span>
          {onDismissStatus ? (
            <button type="button" onClick={onDismissStatus} aria-label="Dismiss export message">
              <X size={13} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}

      {renameFormat ? (
        <div
          className="rename-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Name your download"
          onKeyDown={handleRenameKeyDown}
        >
          <div className="rename-dialog__backdrop" aria-hidden="true" onMouseDown={cancelRename} />
          <form
            ref={renameCardRef}
            className="rename-dialog__card"
            tabIndex={-1}
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
                  aria-label="File name, without extension"
                  spellCheck={false}
                />
                <span className="rename-dialog__ext" aria-hidden="true">
                  .{renameExt}
                </span>
              </span>
            </label>
            <p className="rename-dialog__hint">
              The system named this for you. Rename it before saving if you like.
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
