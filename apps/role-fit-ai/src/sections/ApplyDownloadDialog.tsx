import { useId, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { EXPORT_META } from "./ExportRail";
import { useModalFocus } from "@typeset/editor/hooks/useModalFocus.ts";
import { swapDocumentTitleKind } from "../lib/downloads.ts";
import type { ApplyDownloadNames, ApplyDownloadPicks } from "../hooks/useApplyFlow";
import type { PreparationPrimaryAction } from "../lib/preparationSession";

// Confirms the tracker commit and optional PDF downloads. Resume and cover
// letter remain separate files because application portals upload them separately.
type ApplyDownloadDialogProps = {
  label: string;
  action: PreparationPrimaryAction;
  defaultFileBaseName: string;
  canDownloadResume: boolean;
  canDownloadCoverLetter: boolean;
  busy: boolean;
  error?: string;
  onDownload: (names: ApplyDownloadNames, picks: ApplyDownloadPicks) => void | Promise<void>;
  onSkip: () => void;
  onApplyOnly: () => void | Promise<void>;
};

export function ApplyDownloadDialog({
  label,
  action,
  defaultFileBaseName,
  canDownloadResume,
  canDownloadCoverLetter,
  busy,
  error,
  onDownload,
  onSkip,
  onApplyOnly
}: ApplyDownloadDialogProps) {
  // Seed the letter from the resume's name retargeted at its own kind, so the
  // pair matches by default without the user typing the name twice.
  const defaultCoverName =
    swapDocumentTitleKind(defaultFileBaseName, "coverLetter") || defaultFileBaseName;
  const [resumeName, setResumeName] = useState(defaultFileBaseName);
  const [coverName, setCoverName] = useState(defaultCoverName);
  // Both exportable materials are checked by default; unchecking one skips only
  // its download — the tracker action and its saved artifacts are unaffected.
  const [pickResume, setPickResume] = useState(canDownloadResume);
  const [pickCoverLetter, setPickCoverLetter] = useState(canDownloadCoverLetter);
  const [submittedAction, setSubmittedAction] = useState<"apply" | "download" | null>(null);
  const fieldId = useId();
  const downloadNoteId = `${fieldId}-download-note`;
  const firstInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const handleModalKeyDown = useModalFocus({
    active: true,
    containerRef: formRef,
    initialFocusRef: firstInputRef,
    onClose: busy ? () => undefined : onSkip,
    selectInitialText: true
  });

  // Checkboxes only earn their place when there is a choice to make; with one
  // exportable document the secondary action already covers skipping download.
  const bothOffered = canDownloadResume && canDownloadCoverLetter;
  const downloadResume = canDownloadResume && (!bothOffered || pickResume);
  const downloadCoverLetter = canDownloadCoverLetter && (!bothOffered || pickCoverLetter);
  const selectedCount = Number(downloadResume) + Number(downloadCoverLetter);
  const ext = EXPORT_META["pdf-engine"].ext;
  const busyMessage =
    submittedAction === "download"
      ? `${action.busyLabel} Exporting ${selectedCount > 1 ? "both PDFs" : "the selected PDF"}…`
      : `${action.busyLabel} Saving included materials…`;

  const row = (
    kind: "resume" | "cover",
    documentLabel: string,
    value: string,
    setValue: (next: string) => void,
    checked: boolean,
    setChecked: (next: boolean) => void,
    first: boolean
  ) => {
    const toggleId = `${fieldId}-${kind}-toggle`;
    const nameId = `${fieldId}-${kind}-name`;
    const downloadLabel = kind === "resume" ? "Download resume PDF" : "Download cover-letter PDF";
    return (
      <div className="apply-download__pick" key={kind}>
        {bothOffered ? (
          <label className="apply-download__pick-toggle" htmlFor={toggleId}>
            <input
              type="checkbox"
              id={toggleId}
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
              aria-describedby={downloadNoteId}
              disabled={busy}
            />
            <span>{downloadLabel}</span>
          </label>
        ) : (
          <label className="apply-download__pick-kind" htmlFor={nameId}>
            {documentLabel}
          </label>
        )}
        <span className="rename-dialog__input-wrap apply-download__pick-name">
          <input
            ref={first ? firstInputRef : undefined}
            id={nameId}
            className="rename-dialog__input"
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-label={`${documentLabel} file name, without extension`}
            spellCheck={false}
            disabled={busy || !checked}
          />
          <span className="rename-dialog__ext" aria-hidden="true">.{ext}</span>
        </span>
      </div>
    );
  };

  return (
    <div
      className="rename-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={`${action.label} and download documents`}
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
          if (!selectedCount) return;
          setSubmittedAction("download");
          void onDownload(
            {
              resume: resumeName.trim() || defaultFileBaseName,
              coverLetter: coverName.trim() || defaultCoverName
            },
            { resume: downloadResume, coverLetter: downloadCoverLetter }
          );
        }}
      >
        <button type="button" className="apply-download__close" onClick={onSkip} aria-label="Cancel" title={`Cancel without ${action.label.toLowerCase()}`} disabled={busy}>
          <X size={14} />
        </button>
        <p className="rename-dialog__hint">
          {action.kind === "apply" ? "Apply to " : `${action.label} for `}
          <strong>{label}</strong>. Name each file before downloading.
        </p>

        <div className="apply-download__picks">
          {canDownloadResume
            ? row("resume", "Resume", resumeName, setResumeName, downloadResume, setPickResume, true)
            : null}
          {canDownloadCoverLetter
            ? row(
                "cover",
                "Cover letter",
                coverName,
                setCoverName,
                downloadCoverLetter,
                setPickCoverLetter,
                !canDownloadResume
              )
            : null}
        </div>
        <p className="rename-dialog__hint apply-download__name-hint">
          {bothOffered ? (
            <span id={downloadNoteId}>
              Unchecking a PDF skips only its download; included materials are still saved to the application. The
              extension is added for you.
            </span>
          ) : (
            "Included materials are saved to the application. The extension is added for you."
          )}
        </p>

        {busy ? (
          <p className="apply-download__busy" role="status" aria-live="polite" aria-atomic="true">
            {busyMessage}
          </p>
        ) : null}

        {error ? <p className="rename-dialog__error" role="alert">{error}</p> : null}

        <footer className="rename-dialog__actions">
          <button
            type="button"
            className="ghost-button is-compact"
            onClick={() => {
              setSubmittedAction("apply");
              void onApplyOnly();
            }}
            title={`${action.label} without downloading`}
            disabled={busy}
          >
            {busy && submittedAction === "apply"
              ? action.busyLabel
              : action.kind === "apply"
                ? "Apply only"
                : action.kind === "update-job"
                  ? "Save without downloading"
                  : "Update without downloading"}
          </button>
          <button type="submit" className="primary-button is-compact" disabled={busy || !selectedCount}>
            <Download size={13} aria-hidden="true" />
            {busy && submittedAction === "download"
              ? `${action.busyLabel.replace(/…$/, "")} & exporting…`
              : selectedCount > 1
                ? `${action.label} & download both`
                : `${action.label} & download`}
          </button>
        </footer>
      </form>
    </div>
  );
}
