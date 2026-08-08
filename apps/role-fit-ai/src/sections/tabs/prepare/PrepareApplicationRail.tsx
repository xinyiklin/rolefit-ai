import type { ReactNode } from "react";
import { Check, Circle, LoaderCircle, Minus } from "lucide-react";

import type { Application } from "../../../hooks/useApplications";
import type { PreparationReadiness } from "../../../lib/preparationReadiness";
import type { QuickFitState, QuickFitVerdict } from "../../../../shared/quickFitContract.ts";

// Preparation is one of the readiness checks, so its progress earns rail space
// only while something is actually happening or a message is outstanding.
export type PrepareActivity = {
  tone: "working" | "warn" | "info";
  message: string;
};

const QUICK_FIT_LABEL: Record<QuickFitVerdict, string> = {
  STRONG: "Strong fit",
  REASONABLE: "Reasonable fit",
  STRETCH: "Stretch",
  LIMITED: "Limited fit"
};

type PrepareApplicationRailProps = {
  activity: PrepareActivity | null;
  quickFit: QuickFitState;
  onRetryInitialFit: () => void;
  linkedApplication: Application | null;
  readiness: PreparationReadiness;
  isApplying: boolean;
  onApply: () => void | Promise<void>;
  children: ReactNode;
};

export function PrepareApplicationRail({
  activity,
  quickFit,
  onRetryInitialFit,
  linkedApplication,
  readiness,
  isApplying,
  onApply,
  children
}: PrepareApplicationRailProps) {
  const hasSavedResume = Boolean(
    linkedApplication?.resumeArtifacts?.hasSource || linkedApplication?.resumeArtifacts?.hasPdf
  );
  const hasSavedCoverLetter = Boolean(
    linkedApplication?.coverLetterArtifacts?.hasSource || linkedApplication?.coverLetterArtifacts?.hasPdf
  );

  return (
    <aside className="prepare-rail" aria-label="Application setup">
      <section className="prepare-panel prepare-application">
        <div className="prepare-panel__head">
          <h3>Application</h3>
          <span className="prepare-panel__meta">{readiness.canApply ? "Ready to apply" : "In progress"}</span>
        </div>

        <div className="prepare-materials" aria-label="Included materials">
          {children}
        </div>

        <div className="prepare-fit">
          <p className="prepare-page__eyebrow">Initial Fit</p>
          {quickFit.status === "ready" ? (
            <>
              <div className="prepare-fit__summary">
                <strong className={`quick-fit-verdict is-${quickFit.snapshot.result.verdict.toLowerCase()}`}>
                  {QUICK_FIT_LABEL[quickFit.snapshot.result.verdict]}
                </strong>
                <span>{quickFit.snapshot.resumeLabel}</span>
              </div>
              <p>{quickFit.snapshot.result.summary}</p>
              {quickFit.snapshot.result.matches.length ? (
                <div className="quick-fit-list">
                  <strong>Matches</strong>
                  <ul>
                    {quickFit.snapshot.result.matches.map((match) => <li key={match}>{match}</li>)}
                  </ul>
                </div>
              ) : null}
              {quickFit.snapshot.result.gaps.length ? (
                <div className="quick-fit-list">
                  <strong>Important gaps</strong>
                  <ul>
                    {quickFit.snapshot.result.gaps.map((gap) => <li key={gap}>{gap}</li>)}
                  </ul>
                </div>
              ) : null}
              {quickFit.snapshot.result.eligibility && quickFit.snapshot.result.eligibility.status !== "CLEAR" ? (
                <p className="quick-fit-eligibility">
                  {quickFit.snapshot.result.eligibility.note || "Check the role's eligibility requirement before applying."}
                </p>
              ) : null}
            </>
          ) : quickFit.status === "running" ? (
            <p className="prepare-note is-working" role="status">
              <LoaderCircle className="spin" size={13} aria-hidden="true" />
              Checking {quickFit.resumeLabel}…
            </p>
          ) : quickFit.status === "disabled" ? (
            <p>Off in Settings. You can continue directly to Polish.</p>
          ) : (
            <>
              <strong className="prepare-fit__empty">Initial Fit unavailable</strong>
              <p>{quickFit.message}</p>
              {quickFit.resumeLabel ? (
                <button className="ghost-button is-compact" type="button" onClick={onRetryInitialFit}>
                  Retry fit check
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

        {linkedApplication ? (
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
          disabled={!readiness.canApply || isApplying}
          title={readiness.canApply ? "Mark as applied and save included materials" : readiness.primaryBlocker}
        >
          {isApplying ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : null}
          {isApplying ? "Applying…" : "Apply"}
        </button>
        {!readiness.canApply ? <p className="prepare-apply-hint">{readiness.primaryBlocker}</p> : null}
      </section>
    </aside>
  );
}
