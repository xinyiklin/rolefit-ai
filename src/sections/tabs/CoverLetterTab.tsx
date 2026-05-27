import { Clipboard } from "lucide-react";
import type { PolishedResume } from "../../resumeEngine";

type CoverLetterTabProps = {
  result: PolishedResume | null;
  includeCoverLetter: boolean;
  coverCopied: boolean;
  onCopy: () => void | Promise<void>;
  onEnable: () => void;
};

export function CoverLetterTab({
  result,
  includeCoverLetter,
  coverCopied,
  onCopy,
  onEnable
}: CoverLetterTabProps) {
  return (
    <section className="studio-card">
      <div className="studio-card__head">
        <h2>Cover letter</h2>
        <button
          className="ghost-button is-compact"
          type="button"
          disabled={!result?.coverLetterText}
          onClick={onCopy}
        >
          <Clipboard size={12} aria-hidden="true" />
          <span>{coverCopied ? "Copied" : "Copy"}</span>
        </button>
      </div>

      {!includeCoverLetter && !result?.coverLetterText ? (
        <div className="recovery-strip">
          <div>
            <strong>Cover letter is off</strong>
            <span>Toggle on, then polish.</span>
          </div>
          <button className="secondary-button is-compact" type="button" onClick={onEnable}>
            Enable
          </button>
        </div>
      ) : null}

      <textarea
        className="resume-output cover-letter-output"
        readOnly
        aria-label="Copy-ready cover letter"
        value={result?.coverLetterText || "Cover letter draft appears here after polishing with the option on."}
      />
    </section>
  );
}
