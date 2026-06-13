import type { ReactNode } from "react";
import { ClipboardCheck, Sparkles } from "lucide-react";

type MastheadProps = {
  // Mark the current role as applied and save it to the pipeline, using the
  // resume draft currently in the editor.
  onApply: () => void;
  applyDisabled: boolean;
  // Primary action: run the polish. The hint explains a disabled button.
  onPolish: () => void | Promise<void>;
  canPolish: boolean;
  isPolishing: boolean;
  polishHint: string;
  resumeControl?: ReactNode;
  jobControl?: ReactNode;
  aiControl?: ReactNode;
  polishControl?: ReactNode;
};

export function Masthead({
  onApply,
  applyDisabled,
  onPolish,
  canPolish,
  isPolishing,
  polishHint,
  resumeControl,
  jobControl,
  aiControl,
  polishControl
}: MastheadProps) {
  return (
    <header className="masthead" aria-label="Workspace header">
      <div className="masthead__brand">
        <h1>RoleFit AI</h1>
      </div>
      <div className="masthead__menus">
        <div className="menu-group" role="group" aria-label="Inputs">
          {resumeControl}
          {jobControl}
        </div>
        <div className="menu-group" role="group" aria-label="Polish setup">
          {aiControl}
          {polishControl}
        </div>
      </div>
      <div className="masthead__actions">
        <button
          className="primary-button is-compact masthead__polish"
          type="button"
          onClick={onPolish}
          disabled={!canPolish || isPolishing}
          title={canPolish ? "Tailor the resume to the job (AI polish + recruiter review)" : polishHint}
        >
          <Sparkles size={13} aria-hidden="true" />
          <span>{isPolishing ? "Working…" : "Polish"}</span>
        </button>
        <button
          className="secondary-button is-compact masthead__apply"
          type="button"
          onClick={onApply}
          disabled={applyDisabled}
          title="Mark as applied and save to the pipeline using the current resume draft"
        >
          <ClipboardCheck size={14} aria-hidden="true" />
          <span>Apply</span>
        </button>
      </div>
    </header>
  );
}
