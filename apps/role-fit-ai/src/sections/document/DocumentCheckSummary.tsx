import { Square } from "lucide-react";

import type { FinalCheckResult } from "../../../shared/finalCheckContract.ts";
import type { DocumentWorkflowStaleReason } from "../../../shared/documentWorkflowContract.ts";
import type { DocumentCheckSource } from "../../hooks/useDocumentCheck";
import type { AiStageState } from "../../lib/aiWorkflow";

type DocumentCheckSummaryProps = {
  documentNoun: string;
  check: FinalCheckResult | null;
  source: DocumentCheckSource;
  staleReason: DocumentWorkflowStaleReason | undefined;
  progress: AiStageState;
  isChecking: boolean;
  canCheck: boolean;
  blocker: string;
  onCheck: () => void;
  onStop: () => void;
};

const OUTCOME_LABELS: Record<FinalCheckResult["status"], string> = {
  READY: "Ready",
  REVIEW: "Review",
  NEEDS_EVIDENCE: "Needs evidence"
};

const ISSUE_LABELS: Record<FinalCheckResult["issues"][number]["kind"], string> = {
  UNSUPPORTED: "Unsupported",
  MISSING: "Missing",
  CLARITY: "Clarity"
};

// The closing phase of Polish, not a tool of its own: there is no section
// heading, no explanation of what a check is, and no primary "Run" button. The
// only action offered is re-checking a document that has moved on.
export function DocumentCheckSummary({
  documentNoun,
  check,
  source,
  staleReason,
  progress,
  isChecking,
  canCheck,
  blocker,
  onCheck,
  onStop
}: DocumentCheckSummaryProps) {
  const failed = progress.status === "failed" || progress.status === "stopped";

  if (isChecking) {
    return (
      <div className="document-check is-checking">
        <p role="status">
          Reviewing the current {documentNoun} for evidence, coverage, and clarity.
        </p>
        <button className="ghost-button is-compact" type="button" onClick={onStop}>
          <Square size={9} fill="currentColor" strokeWidth={0} aria-hidden="true" /> Stop
        </button>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="document-check is-failed">
        <p role="alert">
          <strong>{progress.errorHeadline || "The check did not finish"}</strong>
          {progress.error ? `: ${progress.error}` : ""} Your {documentNoun} was not affected.
        </p>
        {canCheck ? (
          <button className="ghost-button is-compact" type="button" onClick={onCheck}>Check again</button>
        ) : null}
      </div>
    );
  }

  if (!check) {
    // Silent by default. Before a proposal settles there is nothing to say, and
    // saying it would reintroduce the standalone step this replaced.
    return blocker ? <p className="document-check__note">{blocker}</p> : null;
  }

  return (
    <div className={`document-check is-${check.status.toLowerCase().replace("_", "-")}${staleReason ? " is-stale" : ""}`}>
      <div className="document-check__outcome">
        <span>{staleReason === "document-changed" ? "Changed since check" : staleReason ? "Out of date" : OUTCOME_LABELS[check.status]}</span>
        {staleReason ? null : <small>{check.issues.length ? `${check.issues.length} to review` : "No material issues"}</small>}
      </div>
      <p>
        {staleReason === "document-changed"
          ? `The current ${documentNoun} no longer matches what was checked.`
          : staleReason
            ? `The job, evidence, or guidance changed after this ${documentNoun} was checked.`
            : source === "polish-validation"
              ? `This ${documentNoun} passed evidence checks during Polish.`
              : check.summary}
      </p>
      {!staleReason && check.issues.length ? (
        <ol className="document-check__issues">
          {check.issues.map((issue, index) => (
            <li key={`${issue.kind}-${index}-${issue.detail}`}>
              <span>{ISSUE_LABELS[issue.kind]}</span>
              <p>{issue.detail}</p>
              <small>{issue.action}</small>
            </li>
          ))}
        </ol>
      ) : null}
      {staleReason ? (
        canCheck ? (
          <button className="ghost-button is-compact" type="button" onClick={onCheck}>Check again</button>
        ) : blocker ? <p className="document-check__note">{blocker}</p> : null
      ) : null}
    </div>
  );
}
