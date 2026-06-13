import { useEffect, useRef, useState } from "react";
import { Check, Download, FileCode2, FileText, Star, X } from "lucide-react";
import type { ExportFormat } from "../lib/exportPrefs";
import { EXPORT_META } from "./ExportRail";

// Shown right after Apply: offers to download a copy of the resume that just went
// out, in one of the three export formats, lets the user name the file, and
// remember the format as their default. Reuses the rename-dialog visual shell.
type ApplyDownloadDialogProps = {
  // Application title, for context in the header ("Stripe — Software Engineer").
  label: string;
  // Disables the Tectonic-PDF option when Tectonic is not installed.
  tectonicAvailable: boolean;
  // The remembered default, pre-selected when the dialog opens.
  defaultFormat: ExportFormat | null;
  // System-proposed file name (extension excluded) — pre-fills the name field.
  defaultFileBaseName: string;
  onDownload: (format: ExportFormat, makeDefault: boolean, fileBaseName: string) => void;
  onSkip: () => void;
};

const FORMAT_ORDER: ExportFormat[] = ["pdf-latex", "pdf-clean", "tex"];

const FORMAT_HINT: Record<ExportFormat, string> = {
  "pdf-latex": "Compiled via Tectonic + your template.",
  "pdf-clean": "Opens your browser's Save-as-PDF dialog.",
  tex: "LaTeX source for the selected template."
};

const FORMAT_ICON: Record<ExportFormat, typeof Download> = {
  "pdf-latex": Download,
  "pdf-clean": FileText,
  tex: FileCode2
};

export function ApplyDownloadDialog({
  label,
  tectonicAvailable,
  defaultFormat,
  defaultFileBaseName,
  onDownload,
  onSkip
}: ApplyDownloadDialogProps) {
  // Pre-select the remembered default; fall back to the first enabled option so
  // there is always a valid selection. PDF·LaTeX is unavailable without Tectonic.
  const isEnabled = (format: ExportFormat) => format !== "pdf-latex" || tectonicAvailable;
  const initial =
    defaultFormat && isEnabled(defaultFormat)
      ? defaultFormat
      : FORMAT_ORDER.find(isEnabled) ?? "pdf-clean";

  const [selected, setSelected] = useState<ExportFormat>(initial);
  // Pre-check "remember" when the current pick already matches a saved default,
  // so confirming keeps it; otherwise leave it to the user to opt in.
  const [makeDefault, setMakeDefault] = useState<boolean>(selected === defaultFormat);
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

  const isCleanPdf = selected === "pdf-clean";

  return (
    <div className="rename-dialog" role="dialog" aria-modal="true" aria-label="Download the resume you applied with">
      <div className="rename-dialog__backdrop" onClick={onSkip} />
      <form
        className="rename-dialog__card apply-download"
        onSubmit={(event) => {
          event.preventDefault();
          onDownload(selected, makeDefault, fileName.trim());
        }}
      >
        <header className="rename-dialog__head">
          <Download size={14} aria-hidden="true" />
          <span>Download a copy</span>
        </header>
        <p className="rename-dialog__hint">
          Applied to <strong>{label}</strong>. Pick a format and name the file you're saving.
        </p>

        <div className="apply-download__field-label">Format</div>
        <div className="apply-download__options" role="radiogroup" aria-label="Download format">
          {FORMAT_ORDER.map((format) => {
            const enabled = isEnabled(format);
            const Icon = FORMAT_ICON[format];
            const isSel = selected === format;
            return (
              <button
                key={format}
                type="button"
                role="radio"
                aria-checked={isSel}
                className={`apply-download__option${isSel ? " is-selected" : ""}`}
                disabled={!enabled}
                onClick={() => {
                  setSelected(format);
                  if (defaultFormat) setMakeDefault(format === defaultFormat);
                }}
                title={enabled ? FORMAT_HINT[format] : "Install Tectonic (brew install tectonic) to enable LaTeX PDF."}
              >
                <span className="apply-download__option-icon" aria-hidden="true">
                  <Icon size={16} />
                </span>
                <span className="apply-download__option-text">
                  <span className="apply-download__option-label">{EXPORT_META[format].label}</span>
                  <span className="apply-download__option-hint">
                    {enabled ? FORMAT_HINT[format] : "Needs Tectonic installed."}
                  </span>
                </span>
                <span className="apply-download__radio" aria-hidden="true">
                  {isSel ? <Check size={13} /> : null}
                </span>
              </button>
            );
          })}
        </div>

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
              .{EXPORT_META[selected].ext}
            </span>
          </span>
          <span className="rename-dialog__hint apply-download__name-hint">
            {isCleanPdf
              ? "Your browser's Save-as-PDF dialog opens next, pre-filled with this name."
              : "Rename it before saving if you like — the extension is added for you."}
          </span>
        </label>

        <label className={`apply-download__remember${makeDefault ? " is-on" : ""}`}>
          <input
            type="checkbox"
            checked={makeDefault}
            onChange={(event) => setMakeDefault(event.target.checked)}
          />
          <Star size={14} aria-hidden="true" className="apply-download__remember-icon" />
          <span className="apply-download__remember-text">
            <span className="apply-download__remember-title">Make this my default download choice</span>
            <span className="apply-download__remember-sub">Next time you Apply, this format is pre-selected.</span>
          </span>
        </label>

        <footer className="rename-dialog__actions">
          <button type="button" className="ghost-button is-compact" onClick={onSkip}>
            <X size={12} aria-hidden="true" />
            Not now
          </button>
          <button type="submit" className="primary-button is-compact">
            <Download size={13} aria-hidden="true" />
            Download
          </button>
        </footer>
      </form>
    </div>
  );
}
