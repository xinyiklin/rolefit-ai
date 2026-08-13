import { ClipboardCheck } from "lucide-react";
import type { RefObject } from "react";
import type { PreparationPrimaryAction } from "../lib/preparationSession";

type MastheadProps = {
  onApply: () => void | Promise<void>;
  primaryAction: PreparationPrimaryAction;
  busy: boolean;
  applyDisabled: boolean;
  applyHint: string;
  actionRef: RefObject<HTMLButtonElement | null>;
};

export function Masthead({
  onApply,
  primaryAction,
  busy,
  applyDisabled,
  applyHint,
  actionRef
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
            ref={actionRef}
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
      </div>
    </header>
  );
}
