import type { ReactNode } from "react";
import { ClipboardCheck, X } from "lucide-react";

type MastheadProps = {
  // Mark the current role as applied and save it to the pipeline, using the
  // resume draft currently in the editor. Runs a duplicate-application scan
  // first (may await a confirm dialog), hence the async-friendly signature.
  onApply: () => void | Promise<void>;
  applyDisabled: boolean;
  // Explains why Apply is greyed out (mirrors polishHint).
  applyHint: string;
  applyStatus?: string;
  applyStatusIsError?: boolean;
  onDismissApplyStatus?: () => void;
  jobControl?: ReactNode;
  sessionsControl?: ReactNode;
};

export function Masthead({
  onApply,
  applyDisabled,
  applyHint,
  applyStatus,
  applyStatusIsError = false,
  onDismissApplyStatus,
  jobControl,
  sessionsControl
}: MastheadProps) {
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
        {/* Provider and guidance setup moved to the Settings dialog, opened from
            the bottom of the studio sidebar. */}
        <div className="menu-group" role="group" aria-label="Inputs">
          {jobControl}
        </div>
      </div>
      <div className="masthead__actions">
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
        {applyStatus ? (
          <div className="masthead-feedback-stack">
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
          </div>
        ) : null}
      </div>
    </header>
  );
}
