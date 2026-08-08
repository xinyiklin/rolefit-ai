import { Square } from "lucide-react";

import type { FinalCheckResult } from "../../../shared/finalCheckContract.ts";
import type { AiStageState } from "../../lib/aiWorkflow";

type FinalCheckPanelProps = {
  result: FinalCheckResult | null;
  stale: boolean;
  progress: AiStageState;
  status: string;
  canRun: boolean;
  isChecking: boolean;
  blocker: string;
  onRun: () => void;
  onStop: () => void;
};

const STATUS_LABELS: Record<FinalCheckResult["status"], string> = {
  READY: "Ready",
  REVIEW: "Review",
  NEEDS_EVIDENCE: "Needs evidence"
};

const ISSUE_LABELS: Record<FinalCheckResult["issues"][number]["kind"], string> = {
  UNSUPPORTED: "Unsupported",
  MISSING: "Missing",
  CLARITY: "Clarity"
};

export function FinalCheckPanel({
  result,
  stale,
  progress,
  status,
  canRun,
  isChecking,
  blocker,
  onRun,
  onStop
}: FinalCheckPanelProps) {
  const failed = progress.status === "failed" || progress.status === "stopped";
  const actionLabel = result || failed ? "Run Final Check again" : "Run Final Check";

  return (
    <section className="final-check" aria-labelledby="final-check-heading">
      <div className="final-check__head">
        <div>
          <h3 id="final-check-heading">Final Check</h3>
          <p>Optional review of the actual current resume.</p>
        </div>
        {isChecking ? (
          <button className="ghost-button is-compact" type="button" onClick={onStop}>
            <Square size={9} fill="currentColor" strokeWidth={0} aria-hidden="true" /> Stop
          </button>
        ) : (
          <button className="secondary-button is-compact" type="button" onClick={onRun} disabled={!canRun}>
            {actionLabel}
          </button>
        )}
      </div>

      {!canRun && !isChecking && blocker ? <p className="final-check__note">{blocker}</p> : null}
      {isChecking ? <p className="final-check__note" role="status">Checking the current resume…</p> : null}
      {failed ? (
        <p className="final-check__failure" role="alert">
          <strong>{progress.errorHeadline || "Final Check unavailable"}</strong>
          {progress.error ? `: ${progress.error}` : ""} Polish and Apply are unaffected.
        </p>
      ) : null}

      {result ? (
        <div className={`final-check__result is-${result.status.toLowerCase().replace("_", "-")}${stale ? " is-stale" : ""}`}>
          <div className="final-check__status">
            <span>{STATUS_LABELS[result.status]}</span>
            {stale ? <small>Out of date</small> : null}
          </div>
          <p>{result.summary}</p>
          {result.issues.length ? (
            <ol className="final-check__issues">
              {result.issues.map((issue, index) => (
                <li key={`${issue.kind}-${index}-${issue.detail}`}>
                  <span>{ISSUE_LABELS[issue.kind]}</span>
                  <p>{issue.detail}</p>
                  <small>{issue.action}</small>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}

      {!isChecking && !failed && status && !result ? <p className="final-check__note" role="status">{status}</p> : null}
    </section>
  );
}
