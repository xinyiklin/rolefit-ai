import { AlertCircle, Check, Circle, LoaderCircle, Minus, RefreshCcw, Square } from "lucide-react";

import type { FitAssessment, RequirementCoverage } from "../../../../shared/fitAssessmentContract.ts";
import type { PrepareAutomationActionState, PrepareAutomationState } from "../../../hooks/usePrepareAutomation";
import type { AutoPolishThreshold } from "../../../lib/prepareAutomation";
import { VERDICT_LABEL, verdictPillClass } from "../../../lib/fitVerdict";

export type PrepareInitialFitView = {
  status: "waiting" | "selecting" | "running" | "ready" | "saved" | "stale" | "failed" | "stopped";
  assessment?: FitAssessment;
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
  OFF: "Off",
  STRETCH: "Stretch or better",
  REASONABLE_FIT: "Reasonable fit or better",
  STRONG_FIT: "Strong fit"
};

const COVERAGE_LABEL: Record<RequirementCoverage, string> = {
  COVERED: "Covered",
  ADJACENT: "Adjacent",
  MISSING: "Missing",
  UNCERTAIN: "Uncertain"
};

const ELIGIBILITY_LABEL = {
  SATISFIED: "Eligibility satisfied",
  UNCERTAIN: "Eligibility needs confirmation",
  NOT_SATISFIED: "Eligibility condition not satisfied"
} as const;

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

function RequirementSummary({ assessment }: { assessment: FitAssessment }) {
  const counts: Record<RequirementCoverage, number> = {
    COVERED: 0,
    ADJACENT: 0,
    MISSING: 0,
    UNCERTAIN: 0
  };
  for (const requirement of assessment.requirements) {
    if (requirement.importance === "CORE") counts[requirement.coverage] += 1;
  }
  return (
    <p className="prepare-fit__requirement-summary">
      {counts.COVERED} core covered
      <span aria-hidden="true"> · </span>
      {counts.ADJACENT} adjacent
      <span aria-hidden="true"> · </span>
      {counts.MISSING} missing
      {counts.UNCERTAIN ? <><span aria-hidden="true"> · </span>{counts.UNCERTAIN} uncertain</> : null}
    </p>
  );
}

function FitAssessmentDetails({ assessment }: { assessment: FitAssessment }) {
  const coreGaps = assessment.requirements.filter(
    (requirement) => requirement.importance === "CORE" && requirement.coverage !== "COVERED"
  );
  const eligibilityQuestions = assessment.eligibility.items.filter((item) => item.status !== "SATISFIED");

  return (
    <>
      <div className="prepare-fit__summary">
        <strong className={`verdict-pill ${verdictPillClass(assessment.verdict)}`}>
          {VERDICT_LABEL[assessment.verdict]}
        </strong>
        <span>{assessment.confidence.toLowerCase()} confidence</span>
      </div>
      <p className={`prepare-fit__eligibility is-${assessment.eligibility.status.toLowerCase().replace("_", "-")}`}>
        {ELIGIBILITY_LABEL[assessment.eligibility.status]}
      </p>
      <RequirementSummary assessment={assessment} />
      <p className="prepare-fit__reason">{assessment.summary}</p>
      <p className="prepare-fit__verdict-reason">{assessment.verdictReason}</p>

      {assessment.strengths.length || assessment.concerns.length || coreGaps.length || eligibilityQuestions.length ? (
        <div className="prepare-fit-evidence">
          {assessment.strengths.length ? (
            <div>
              <strong>Strengths</strong>
              <ul>{assessment.strengths.map((strength) => <li key={strength}>{strength}</li>)}</ul>
            </div>
          ) : null}
          {assessment.concerns.length ? (
            <div>
              <strong>Concerns</strong>
              <ul>{assessment.concerns.map((concern) => <li key={concern}>{concern}</li>)}</ul>
            </div>
          ) : null}
          {coreGaps.length ? (
            <div>
              <strong>Core gaps</strong>
              <ul>
                {coreGaps.map((requirement) => (
                  <li key={requirement.id}>{requirement.requirement} · {COVERAGE_LABEL[requirement.coverage]}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {eligibilityQuestions.length ? (
            <div>
              <strong>Eligibility</strong>
              <ul>{eligibilityQuestions.map((item) => <li key={item.id}>{item.requirement} · {item.explanation}</li>)}</ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <details className="prepare-fit-ledger">
        <summary>Requirement evidence</summary>
        <ol>
          {assessment.requirements.map((requirement) => (
            <li key={requirement.id}>
              <div className="prepare-fit-ledger__head">
                <strong>{requirement.requirement}</strong>
                <span>{requirement.importance === "CORE" ? "Core" : "Supporting"} · {COVERAGE_LABEL[requirement.coverage]}</span>
              </div>
              <p>{requirement.explanation}</p>
              {requirement.evidence.length ? (
                <ul className="prepare-fit-ledger__evidence">
                  {requirement.evidence.map((evidence, index) => (
                    <li key={`${requirement.id}:${evidence.source}:${index}`}>
                      <span>{evidence.source === "RESUME" ? "Resume" : "About you"}</span>
                      <q>{evidence.excerpt}</q>
                    </li>
                  ))}
                </ul>
              ) : null}
              {requirement.canSurfaceInResume ? <small>Can be surfaced more clearly in the resume.</small> : null}
            </li>
          ))}
        </ol>
      </details>

      <div className="prepare-fit__recommendation">
        <strong>Recommendation</strong>
        <span>{assessment.recommendation.action.replace(/_/g, " ").toLowerCase()}</span>
        <p>{assessment.recommendation.reason}</p>
      </div>
    </>
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
  const hasResult = Boolean(initialFit.assessment);
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

        {initialFit.assessment ? (
          <>
            <FitAssessmentDetails assessment={initialFit.assessment} />
            {initialFit.status === "stale" ? (
              <p className="prepare-note is-warn" role="status">{initialFit.message}</p>
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
