import { ClipboardCheck, X } from "lucide-react";
import type { PreparationPrimaryAction } from "../lib/preparationSession";

type MastheadProps = {
  // Mark the current role as applied and save the included materials. Runs a
  // duplicate-application scan first (which may await a confirm dialog), hence
  // the async-friendly signature.
  onApply: () => void | Promise<void>;
  primaryAction: PreparationPrimaryAction;
  busy: boolean;
  applyDisabled: boolean;
  // Explains why Apply is greyed out (mirrors polishHint).
  applyHint: string;
  applyStatus?: string;
  applyStatusIsError?: boolean;
  onDismissApplyStatus?: () => void;
};

export function Masthead({
  onApply,
  primaryAction,
  busy,
  applyDisabled,
  applyHint,
  applyStatus,
  applyStatusIsError = false,
  onDismissApplyStatus
}: MastheadProps) {
  const actionDescription = primaryAction.kind === "update-job"
    ? "Save prepared job updates"
    : primaryAction.kind === "update-application"
      ? "Update application and save included materials"
      : "Apply prepared application and save included materials";

  return (
    <header className="masthead" aria-label="Workspace header">
      <div className="masthead__brand">
        <span className="masthead__mark" aria-hidden="true">
          R
        </span>
        <h1>RoleFit AI</h1>
      </div>
      <div className="masthead__actions">
        <span className="masthead-action">
          <button
            className="secondary-button is-compact masthead__apply"
            type="button"
            onClick={() => {
              if (!applyDisabled) void onApply();
            }}
            aria-label={actionDescription}
            aria-disabled={applyDisabled}
            aria-describedby={applyDisabled ? "masthead-apply-hint" : undefined}
            aria-busy={busy}
            title={applyDisabled ? applyHint : actionDescription}
          >
            <ClipboardCheck size={14} aria-hidden="true" />
            <span>{busy ? primaryAction.busyLabel : primaryAction.label}</span>
          </button>
          {applyDisabled ? (
            <span className="masthead-action__hint" id="masthead-apply-hint">
              {applyHint}
            </span>
          ) : null}
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
                <button type="button" onClick={onDismissApplyStatus} aria-label="Dismiss application action message">
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
