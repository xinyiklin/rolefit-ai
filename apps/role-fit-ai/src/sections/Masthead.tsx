import type { ReactNode } from "react";
import { ClipboardCheck, Sparkles, X } from "lucide-react";

type MastheadProps = {
  // Mark the current role as applied and save it to the pipeline, using the
  // resume draft currently in the editor. Runs a duplicate-application scan
  // first (may await a confirm dialog), hence the async-friendly signature.
  onApply: () => void | Promise<void>;
  applyDisabled: boolean;
  // Explains why Apply is greyed out (mirrors polishHint).
  applyHint: string;
  // Primary action: run the polish. The hint explains a disabled button.
  onPolish: () => void | Promise<void>;
  canPolish: boolean;
  isPolishing: boolean;
  polishHint: string;
  polishStatus?: string;
  polishStatusIsError?: boolean;
  onDismissPolishStatus?: () => void;
  applyStatus?: string;
  applyStatusIsError?: boolean;
  onDismissApplyStatus?: () => void;
  resumeControl?: ReactNode;
  jobControl?: ReactNode;
  aiControl?: ReactNode;
  polishControl?: ReactNode;
  sessionsControl?: ReactNode;
};

export function Masthead({
  onApply,
  applyDisabled,
  applyHint,
  onPolish,
  canPolish,
  isPolishing,
  polishHint,
  polishStatus,
  polishStatusIsError = false,
  onDismissPolishStatus,
  applyStatus,
  applyStatusIsError = false,
  onDismissApplyStatus,
  resumeControl,
  jobControl,
  aiControl,
  polishControl,
  sessionsControl
}: MastheadProps) {
  const polishDisabled = !canPolish || isPolishing;

  return (
    <header className="masthead" aria-label="Workspace header">
      <div className="masthead__brand">
        <span className="masthead__mark" aria-hidden="true">
          R
        </span>
        <h1>RoleFit AI</h1>
      </div>
      <div className="masthead__menus">
        <div className="menu-group" role="group" aria-label="Sessions">
          {sessionsControl}
        </div>
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
        <span className="masthead-action">
          <button
            className="primary-button is-compact masthead__polish"
            type="button"
            onClick={() => {
              if (!polishDisabled) void onPolish();
            }}
            aria-label={isPolishing ? "Polish in progress" : "Polish resume"}
            aria-disabled={polishDisabled}
            aria-describedby={!canPolish ? "masthead-polish-hint" : undefined}
            title={canPolish ? "Tailor the resume to the job (AI polish + recruiter review)" : polishHint}
          >
            <Sparkles size={14} aria-hidden="true" />
            <span>{isPolishing ? <>Working<span className="loading-dots" aria-hidden="true" /></> : "Polish"}</span>
          </button>
          {!canPolish ? <span className="masthead-action__hint" id="masthead-polish-hint">{polishHint}</span> : null}
        </span>
        <span className="masthead-action">
          <button
            className="secondary-button is-compact masthead__apply"
            type="button"
            onClick={() => {
              if (!applyDisabled) void onApply();
            }}
            aria-label="Apply with current resume"
            aria-disabled={applyDisabled}
            aria-describedby={applyDisabled ? "masthead-apply-hint" : undefined}
            title={applyDisabled ? applyHint : "Mark as applied and save to the pipeline using the current resume draft"}
          >
            <ClipboardCheck size={14} aria-hidden="true" />
            <span>Apply</span>
          </button>
          {applyDisabled ? <span className="masthead-action__hint" id="masthead-apply-hint">{applyHint}</span> : null}
        </span>
        {polishStatus || applyStatus ? (
          <div className="masthead-feedback-stack">
            {polishStatus ? (
              <div
                className={`masthead-feedback${polishStatusIsError ? " masthead-feedback--error" : ""}`}
                role={polishStatusIsError ? "alert" : "status"}
                aria-live={polishStatusIsError ? "assertive" : "polite"}
              >
                <span>{polishStatus}</span>
                {onDismissPolishStatus ? (
                  <button type="button" onClick={onDismissPolishStatus} aria-label="Dismiss Polish message">
                    <X size={13} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ) : null}
            {applyStatus ? (
              <div
                className={`masthead-feedback${applyStatusIsError ? " masthead-feedback--error" : ""}`}
                role={applyStatusIsError ? "alert" : "status"}
                aria-live={applyStatusIsError ? "assertive" : "polite"}
              >
                <span>{applyStatus}</span>
                {onDismissApplyStatus ? (
                  <button type="button" onClick={onDismissApplyStatus} aria-label="Dismiss Apply message">
                    <X size={13} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
