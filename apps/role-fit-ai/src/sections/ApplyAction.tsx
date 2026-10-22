import { ClipboardCheck } from "lucide-react";
import type { RefObject } from "react";
import type { PreparationPrimaryAction } from "../lib/preparationSession";

type ApplyActionProps = {
  onApply: () => void | Promise<void>;
  primaryAction: PreparationPrimaryAction;
  busy: boolean;
  applyDisabled: boolean;
  applyHint: string;
  actionRef: RefObject<HTMLButtonElement | null>;
  // The prepared posting the action records; null until Prepare completes.
  job: { role: string; company: string } | null;
  // Work in progress elsewhere (preparing, polishing), shown with the spinner.
  activity: string | null;
};

type ApplyState = "empty" | "busy" | "ready" | "blocked";

// The global Apply action floats at the workspace's bottom-right on every tab.
// With a prepared job it is a pill naming the role and its readiness in words;
// without one it shrinks to an icon button, which stays mounted because dock
// and dialog dismissals return focus to it. While work runs (preparing,
// polishing, applying) it shows a spinner and the work in words, job or not.
export function ApplyAction({
  onApply,
  primaryAction,
  busy,
  applyDisabled,
  applyHint,
  actionRef,
  job,
  activity
}: ApplyActionProps) {
  const actionDescription = primaryAction.kind === "update-job"
    ? "Save prepared job updates"
    : primaryAction.kind === "update-application"
      ? "Update application and save included materials"
      : "Apply prepared application and save included materials";
  const working = busy || Boolean(activity);
  const state: ApplyState = working ? "busy" : !job ? "empty" : applyDisabled ? "blocked" : "ready";
  // The readiness reason is visible text, not a hover hint, so keyboard and
  // pointer users see the same blocker; it also describes the button.
  const status = state === "busy"
    ? (busy ? primaryAction.busyLabel : activity)
    : state === "blocked"
      ? applyHint
      : "Ready";

  return (
    <aside className="apply-action" data-state={state} aria-label="Application action">
      {job ? (
        <div className="apply-action__text">
          <p className="apply-action__title" title={`${job.role} · ${job.company}`}>
            {job.role}
            <span> · {job.company}</span>
          </p>
          <p className="apply-action__status" id="apply-action-status">{status}</p>
        </div>
      ) : working ? (
        <p className="apply-action__status" id="apply-action-status">{status}</p>
      ) : null}
      <button
        ref={actionRef}
        className="primary-button is-compact apply-action__button"
        type="button"
        onClick={() => {
          if (!applyDisabled) void onApply();
        }}
        aria-label={job ? actionDescription : `${primaryAction.label} — no job prepared`}
        aria-disabled={applyDisabled}
        // With no job the name already says so; the status would repeat it.
        aria-describedby={job || working ? "apply-action-status" : undefined}
        aria-busy={busy}
        // Only the icon-only pill has no visible status to read.
        title={state === "empty" ? applyHint : undefined}
      >
        {working
          ? <span className="apply-action__spinner" aria-hidden="true" />
          : <ClipboardCheck size={15} aria-hidden="true" />}
        <span className={state === "empty" ? "sr-only" : undefined}>
          {busy ? primaryAction.busyLabel : primaryAction.label}
        </span>
      </button>
    </aside>
  );
}
