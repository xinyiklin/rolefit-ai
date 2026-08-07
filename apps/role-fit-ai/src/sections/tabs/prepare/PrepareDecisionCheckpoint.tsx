import { AlertCircle, Check, Circle, LoaderCircle, Minus, RefreshCcw, Square } from "lucide-react";

import type { PrepareAutomationActionState, PrepareAutomationState } from "../../../hooks/usePrepareAutomation";
import type { AutoPolishThreshold } from "../../../lib/prepareAutomation";
import { VERDICT_LABEL, verdictPillClass } from "../../../lib/fitVerdict";
import { displayVerdictReason } from "../../../lib/verdictReason";
import type { StrictReviewVerdict } from "../../../resume/types";

export type PrepareInitialFitView = {
  status: "waiting" | "selecting" | "running" | "ready" | "saved" | "stale" | "failed" | "stopped";
  score?: number;
  verdict?: StrictReviewVerdict;
  reason?: string;
  strengths?: string[];
  blockers?: string[];
  gaps?: string[];
  message?: string;
  resumeFileName?: string;
  provenance?: string;
};

type PrepareDecisionCheckpointProps = {
  initialFit: PrepareInitialFitView;
  automation: PrepareAutomationState;
  resumeThreshold: AutoPolishThreshold;
  coverThreshold: AutoPolishThreshold;
  canPolishResume: boolean;
  canPolishCoverLetter: boolean;
  onRetryInitialFit: () => void | Promise<unknown>;
  onStopInitialFit: () => void;
  onPolishResume: () => void | Promise<unknown>;
  onPolishCoverLetter: () => void | Promise<unknown>;
};

const THRESHOLD_LABEL: Record<AutoPolishThreshold, string> = {
  off: "Off",
  STRETCH: "Stretch or better",
  "REASONABLE FIT": "Reasonable fit or better",
  "STRONG FIT": "Strong fit"
};

function automationCopy(
  action: PrepareAutomationActionState,
  threshold: AutoPolishThreshold
): { label: string; detail: string; tone: string } {
  const thresholdDetail = `Threshold: ${THRESHOLD_LABEL[threshold]}`;
  switch (action.status) {
    case "waiting":
      return { label: "Waiting", detail: action.note, tone: "working" };
    case "running":
      return { label: "Started", detail: thresholdDetail, tone: "working" };
    case "completed":
      return { label: "Complete", detail: `${thresholdDetail} · ${action.note}`, tone: "ready" };
    case "skipped":
      return { label: "Skipped", detail: action.reason, tone: "muted" };
    case "failed":
      return { label: "Needs attention", detail: action.reason, tone: "warn" };
    case "stopped":
      return { label: "Stopped", detail: action.reason, tone: "warn" };
    default:
      return { label: "Pending", detail: thresholdDetail, tone: "muted" };
  }
}

function AutomationRow({
  label,
  action,
  threshold
}: {
  label: string;
  action: PrepareAutomationActionState;
  threshold: AutoPolishThreshold;
}) {
  const copy = automationCopy(action, threshold);
  return (
    <li className={`prepare-automation__row is-${copy.tone}`}>
      <span aria-hidden="true">
        {action.status === "waiting" || action.status === "running" ? (
          <LoaderCircle className="spin" size={12} />
        ) : action.status === "completed" ? (
          <Check size={12} />
        ) : action.status === "skipped" ? (
          <Minus size={12} />
        ) : action.status === "failed" || action.status === "stopped" ? (
          <AlertCircle size={12} />
        ) : (
          <Circle size={8} />
        )}
      </span>
      <div>
        <strong>{label}</strong>
        <span>{copy.label}</span>
        <p>{copy.detail}</p>
      </div>
    </li>
  );
}

export function PrepareDecisionCheckpoint({
  initialFit,
  automation,
  resumeThreshold,
  coverThreshold,
  canPolishResume,
  canPolishCoverLetter,
  onRetryInitialFit,
  onStopInitialFit,
  onPolishResume,
  onPolishCoverLetter
}: PrepareDecisionCheckpointProps) {
  const hasResult = Boolean(initialFit.verdict && initialFit.score !== undefined);
  const auditInFlight = initialFit.status === "selecting" || initialFit.status === "running";
  const canRetry = initialFit.status === "failed" || initialFit.status === "stopped" || initialFit.status === "stale";
  const automationBusy = [automation.resume.status, automation.coverLetter.status]
    .some((status) => status === "waiting" || status === "running");

  return (
    <div className="prepare-decision" aria-label="Initial fit and automation">
      <section className="prepare-initial-fit" aria-labelledby="prepare-initial-fit-title">
        <div className="prepare-decision__head">
          <p className="prepare-page__eyebrow" id="prepare-initial-fit-title">Initial Fit</p>
          {initialFit.status === "saved" ? <span>Historical</span> : null}
        </div>

        {hasResult && initialFit.verdict ? (
          <>
            <div className="prepare-fit__summary">
              <strong className={`verdict-pill ${verdictPillClass(initialFit.verdict)}`}>
                {VERDICT_LABEL[initialFit.verdict]}
              </strong>
              <span>{initialFit.score}/100</span>
            </div>
            {initialFit.reason ? <p>{displayVerdictReason(initialFit.reason)}</p> : null}
            {initialFit.status === "stale" ? (
              <p className="prepare-note is-warn" role="status">{initialFit.message}</p>
            ) : null}
            {initialFit.strengths?.length || initialFit.blockers?.length || initialFit.gaps?.length ? (
              <div className="prepare-fit-evidence">
                {initialFit.strengths?.length ? (
                  <div>
                    <strong>Strengths</strong>
                    <ul>{initialFit.strengths.map((strength, index) => <li key={`${index}:${strength}`}>{strength}</li>)}</ul>
                  </div>
                ) : null}
                {initialFit.blockers?.length ? (
                  <div>
                    <strong>Blockers</strong>
                    <ul>{initialFit.blockers.map((blocker, index) => <li key={`${index}:${blocker}`}>{blocker}</li>)}</ul>
                  </div>
                ) : null}
                {initialFit.gaps?.length ? (
                  <div>
                    <strong>Largest gaps</strong>
                    <ul>{initialFit.gaps.map((gap, index) => <li key={`${index}:${gap}`}>{gap}</li>)}</ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            {initialFit.resumeFileName || initialFit.provenance ? (
              <p className="prepare-fit__provenance">
                {[initialFit.resumeFileName, initialFit.provenance].filter(Boolean).join(" · ")}
              </p>
            ) : null}
          </>
        ) : (
          <p className={`prepare-initial-fit__status${auditInFlight ? " is-working" : ""}`} role="status">
            {auditInFlight ? <LoaderCircle className="spin" size={13} aria-hidden="true" /> : null}
            {initialFit.message || "Waiting for the prepared job and selected resume."}
          </p>
        )}

        <div className="prepare-decision__actions">
          {initialFit.status === "running" ? (
            <button className="ghost-button is-compact" type="button" onClick={onStopInitialFit}>
              <Square size={9} fill="currentColor" strokeWidth={0} aria-hidden="true" />
              Stop
            </button>
          ) : null}
          {canRetry || initialFit.status === "ready" ? (
            <button
              className="ghost-button is-compact"
              type="button"
              onClick={() => void onRetryInitialFit()}
              disabled={automationBusy}
            >
              <RefreshCcw size={11} aria-hidden="true" />
              {initialFit.status === "ready" ? "Re-audit" : initialFit.status === "stale" ? "Re-audit fit" : "Retry"}
            </button>
          ) : null}
        </div>
      </section>

      <section className="prepare-automation" aria-labelledby="prepare-automation-title">
        <p className="prepare-page__eyebrow" id="prepare-automation-title">Automation</p>
        {initialFit.status === "saved" ? (
          <p className="prepare-automation__history-note">
            Automation is not replayed when a saved application is reopened.
          </p>
        ) : (
          <ul>
            <AutomationRow label="Resume polish" action={automation.resume} threshold={resumeThreshold} />
            <AutomationRow label="Cover letter polish" action={automation.coverLetter} threshold={coverThreshold} />
          </ul>
        )}
        {hasResult && initialFit.status !== "saved" ? (
          <div className="prepare-decision__actions">
            <button
              className="ghost-button is-compact"
              type="button"
              onClick={() => void onPolishResume()}
              disabled={!canPolishResume}
            >
              Polish resume anyway
            </button>
            <button
              className="ghost-button is-compact"
              type="button"
              onClick={() => void onPolishCoverLetter()}
              disabled={!canPolishCoverLetter}
            >
              Polish cover letter anyway
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
