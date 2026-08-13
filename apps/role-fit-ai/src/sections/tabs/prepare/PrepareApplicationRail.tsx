import type { ReactNode } from "react";
import { Check, Circle, LoaderCircle, Minus } from "lucide-react";

import type { Application } from "../../../hooks/useApplications";
import {
  displayCompany,
  displayRole,
  fitAssessmentRunLabel,
  fitAssessmentVerdictLabel
} from "../../../lib/applicationDisplay";
import type { PreparationReadiness } from "../../../lib/preparationReadiness";
import type { PreparationPrimaryAction } from "../../../lib/preparationSession";
import type {
  FitAssessmentInputChange,
  FitAssessmentState
} from "../../../../shared/fitAssessmentContract.ts";

// Preparation is one of the readiness checks, so its progress earns rail space
// only while something is actually happening or a message is outstanding.
export type PrepareActivity = {
  tone: "working" | "warn" | "info";
  message: string;
};

const FIT_ASSESSMENT_CHANGE_COPY: Record<FitAssessmentInputChange, { label: string; detail: string }> = {
  job: { label: "Job posting", detail: "Replaced" },
  resume: { label: "Resume content", detail: "Edited" },
  "candidate-context": { label: "About you", detail: "Updated" },
  settings: { label: "Assessment setup", detail: "Changed" }
};

function formatSavedDate(iso?: string) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "date not recorded";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
}

type PrepareApplicationRailProps = {
  activity: PrepareActivity | null;
  fitAssessment: FitAssessmentState;
  onAssessFit: () => void;
  // Whether an assessment can actually run. A resume label is not that
  // signal: the state that most needs recovery — no resume resolved — has no
  // label, which is exactly why it used to offer no way out.
  canAssessFit: boolean;
  linkedApplication: Application | null;
  readiness: PreparationReadiness;
  primaryAction: PreparationPrimaryAction;
  primaryActionReady: boolean;
  primaryActionBlocker: string;
  isApplying: boolean;
  applicationActionsBusy: boolean;
  onApply: () => void | Promise<void>;
  showSkip: boolean;
  canSkip: boolean;
  skipHint: string;
  isSkipping: boolean;
  onSkip: () => void | Promise<void>;
  children: ReactNode;
};

export function PrepareApplicationRail({
  activity,
  fitAssessment,
  onAssessFit,
  canAssessFit,
  linkedApplication,
  readiness,
  primaryAction,
  primaryActionReady,
  primaryActionBlocker,
  isApplying,
  applicationActionsBusy,
  onApply,
  showSkip,
  canSkip,
  skipHint,
  isSkipping,
  onSkip,
  children
}: PrepareApplicationRailProps) {
  const hasSavedResume = Boolean(
    linkedApplication?.resumeArtifacts?.hasSource || linkedApplication?.resumeArtifacts?.hasPdf
  );
  const hasSavedCoverLetter = Boolean(
    linkedApplication?.coverLetterArtifacts?.hasSource || linkedApplication?.coverLetterArtifacts?.hasPdf
  );
  const completedAssessment = fitAssessment.latestCompleted;
  const assessmentSnapshot = completedAssessment?.snapshot ?? null;
  const assessmentRunLabel = assessmentSnapshot ? fitAssessmentRunLabel(assessmentSnapshot) : "";
  const assessmentIsPrevious = Boolean(
    completedAssessment && (
      completedAssessment.changes.length > 0
      || fitAssessment.activeRun
      || fitAssessment.lastError
      || !fitAssessment.enabled
    )
  );
  const assessmentMeta = [
    completedAssessment?.origin === "saved" ? "Saved with application" : "",
    completedAssessment?.previousPreparation
      ? "Previous preparation"
      : assessmentIsPrevious
        ? "Previous assessment"
        : "",
    assessmentRunLabel
  ].filter(Boolean).join(" · ");
  const fitAssessmentMessage = fitAssessment.lastError?.message ?? "";

  return (
    <aside className="prepare-rail" aria-label="Application setup">
      <section className="prepare-panel prepare-application">
        <div className="prepare-panel__head">
          <h3>Application</h3>
          <span className="prepare-panel__meta">
            {primaryActionReady
              ? primaryAction.kind === "apply" ? "Ready to apply" : "Ready to update"
              : "In progress"}
          </span>
        </div>

        {/* A persistent banner, not an announcement — no live region, and the
            consequence rides the identity line rather than a third explainer
            row. */}
        {linkedApplication && primaryAction.kind !== "apply" ? (
          <div className="prepare-update-banner">
            <strong>
              {primaryAction.kind === "update-job" ? "Editing saved job" : "Editing saved application"}
            </strong>
            <span>
              {primaryAction.kind === "update-job"
                ? `Skipped on ${formatSavedDate(linkedApplication.notApplyingAt)} · No application is created`
                : `${displayRole(linkedApplication)} at ${displayCompany(linkedApplication)} · Applied ${formatSavedDate(linkedApplication.appliedAt)} · No new application is created`}
            </span>
          </div>
        ) : null}

        <div className="prepare-materials" aria-label="Included materials">
          {children}
        </div>

        <div className="prepare-fit">
          <p className="prepare-page__eyebrow">Fit Assessment</p>
          {assessmentSnapshot ? (
            <>
              <div className="prepare-fit__summary">
                <strong className={`fit-assessment-verdict is-${assessmentSnapshot.result.verdict.toLowerCase()}`}>
                  {fitAssessmentVerdictLabel(assessmentSnapshot.result.verdict)}
                </strong>
              </div>
              <p>{assessmentSnapshot.result.summary}</p>
              {assessmentMeta ? <p className="prepare-fit__meta">{assessmentMeta}</p> : null}
              {assessmentSnapshot.result.matches.length ? (
                <div className="fit-assessment-list">
                  <strong>Matches</strong>
                  <ul>
                    {assessmentSnapshot.result.matches.map((match) => (
                      <li key={`${match.candidateSource}:${match.jobExcerpt}:${match.candidateExcerpt}`}>
                        {match.jobExcerpt}
                        <small>
                          {match.candidateSource === "RESUME" ? "Resume" : "About you"}: {match.candidateExcerpt}
                        </small>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {assessmentSnapshot.result.gaps.length ? (
                <div className="fit-assessment-list">
                  <strong>Important gaps</strong>
                  <ul>
                    {assessmentSnapshot.result.gaps.map((gap) => <li key={gap}>{gap}</li>)}
                  </ul>
                </div>
              ) : null}
              {assessmentSnapshot.result.eligibility && assessmentSnapshot.result.eligibility.status !== "CLEAR" ? (
                <p className="fit-assessment-eligibility">
                  <strong>
                    {assessmentSnapshot.result.eligibility.status === "BLOCKED"
                      ? "Eligibility conflict."
                      : "Confirm eligibility."}
                  </strong>{" "}
                  {assessmentSnapshot.result.eligibility.jobExcerpt}
                  {assessmentSnapshot.result.eligibility.candidateExcerpt ? (
                    <small>About you: {assessmentSnapshot.result.eligibility.candidateExcerpt}</small>
                  ) : null}
                </p>
              ) : null}
              {completedAssessment?.changes.length ? (
                <div className="fit-assessment-changes" role="status">
                  <strong>Changed since assessment</strong>
                  <ul>
                    {completedAssessment.changes.map((change) => (
                      <li key={change}>
                        <span>{FIT_ASSESSMENT_CHANGE_COPY[change].label}</span>
                        <small>{FIT_ASSESSMENT_CHANGE_COPY[change].detail}</small>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {fitAssessment.activeRun ? (
                <p className="prepare-note is-working" role="status">
                  <LoaderCircle className="spin" size={13} aria-hidden="true" />
                  Assessing fit…
                </p>
              ) : fitAssessment.lastError ? (
                <p className="prepare-note is-warn" role="status">{fitAssessment.lastError.message}</p>
              ) : !fitAssessment.enabled ? (
                <p className="prepare-note is-info">Fit Assessment is off. The completed result is retained.</p>
              ) : null}
              {canAssessFit && !fitAssessment.activeRun ? (
                <button className="ghost-button is-compact" type="button" onClick={onAssessFit} disabled={applicationActionsBusy}>
                  Reassess fit
                </button>
              ) : null}
            </>
          ) : fitAssessment.activeRun ? (
            <p className="prepare-note is-working" role="status">
              <LoaderCircle className="spin" size={13} aria-hidden="true" />
              Assessing fit…
            </p>
          ) : !fitAssessment.enabled ? (
            <p>Off in Settings. You can continue directly to Polish.</p>
          ) : (
            <>
              <strong className="prepare-fit__empty">Assessment unavailable</strong>
              <p>{fitAssessmentMessage}</p>
              {canAssessFit ? (
                <button className="ghost-button is-compact" type="button" onClick={onAssessFit} disabled={applicationActionsBusy}>
                  Retry assessment
                </button>
              ) : null}
            </>
          )}
        </div>

        <div className="prepare-readiness">
          <p className="prepare-page__eyebrow">Readiness</p>

          {activity ? (
            <p className={`prepare-note is-${activity.tone}`} role="status">
              {activity.tone === "working" ? <LoaderCircle className="spin" size={13} aria-hidden="true" /> : null}
              {activity.message}
            </p>
          ) : null}

          <ul className="prepare-checks">
            {Object.values(readiness.checks).map((check) => (
              <li className={`prepare-check is-${check.status}`} key={check.key}>
                <span aria-hidden="true">
                  {check.status === "working" ? (
                    <LoaderCircle className="spin" size={13} />
                  ) : check.status === "excluded" ? (
                    <Minus size={12} />
                  ) : check.ready ? (
                    <Check size={13} />
                  ) : (
                    <Circle size={8} />
                  )}
                </span>
                <strong>{check.label}</strong>
                <span>{check.detail}</span>
              </li>
            ))}
          </ul>
        </div>

        {linkedApplication && primaryAction.kind !== "update-job" ? (
          <div className="prepare-saved">
            <p className="prepare-page__eyebrow">Saved application</p>
            <strong>{linkedApplication.title}</strong>
            <p>
              {hasSavedResume ? "Resume saved" : "No saved resume"}
              {" · "}
              {hasSavedCoverLetter ? "Cover letter saved" : "No saved cover letter"}
            </p>
          </div>
        ) : null}

        <button
          className="primary-button prepare-apply"
          type="button"
          onClick={() => void onApply()}
          disabled={!primaryActionReady || applicationActionsBusy}
          title={primaryActionReady && !applicationActionsBusy ? primaryAction.label : primaryActionBlocker}
        >
          {isApplying ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : null}
          {isApplying ? primaryAction.busyLabel : primaryAction.label}
        </button>
        {(!primaryActionReady || applicationActionsBusy) && primaryActionBlocker ? (
          <p className="prepare-apply-hint">{primaryActionBlocker}</p>
        ) : null}
        {showSkip ? (
          <div className="prepare-skip-action">
            <button
              className="ghost-button is-compact prepare-skip"
              type="button"
              onClick={() => void onSkip()}
              disabled={!canSkip || applicationActionsBusy}
              title={canSkip ? "Save this posting without recording an application" : skipHint}
            >
              {isSkipping ? <LoaderCircle className="spin" size={13} aria-hidden="true" /> : null}
              {isSkipping ? "Saving…" : "Skip & save job"}
            </button>
            {!canSkip && skipHint ? <p className="prepare-skip-hint">{skipHint}</p> : null}
          </div>
        ) : null}
      </section>
    </aside>
  );
}
