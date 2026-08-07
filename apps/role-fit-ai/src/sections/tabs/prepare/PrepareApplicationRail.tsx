import type { ReactNode } from "react";
import { Check, Circle, LoaderCircle, Minus } from "lucide-react";

import type { Application } from "../../../hooks/useApplications";
import type { PreparationReadiness } from "../../../lib/preparationReadiness";
import type { SubmissionAssessment } from "../../../../shared/fitAssessmentContract.ts";

// Preparation is one of the readiness checks, so its progress earns rail space
// only while something is actually happening or a message is outstanding.
export type PrepareActivity = {
  tone: "working" | "warn" | "info";
  message: string;
};

export type PrepareSubmissionAssessment = {
  assessment: SubmissionAssessment;
  provenance: "current" | "saved";
};

type PrepareApplicationRailProps = {
  activity: PrepareActivity | null;
  decisionCheckpoint: ReactNode;
  submissionAssessment: PrepareSubmissionAssessment | null;
  linkedApplication: Application | null;
  readiness: PreparationReadiness;
  isApplying: boolean;
  onApply: () => void | Promise<void>;
  children: ReactNode;
};

export function PrepareApplicationRail({
  activity,
  decisionCheckpoint,
  submissionAssessment,
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

        {decisionCheckpoint}

        {submissionAssessment ? (
          <div className="prepare-fit">
            <p className="prepare-page__eyebrow">Resume readiness</p>
            <div className="prepare-fit__summary">
              <strong className="verdict-pill">
                {submissionAssessment.assessment.readiness.replace(/_/g, " ").toLowerCase()}
              </strong>
              <span>
                {submissionAssessment.provenance === "current" ? "Current review" : "Historical review"}
              </span>
            </div>
            <p>{submissionAssessment.assessment.summary}</p>
          </div>
        ) : null}

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
