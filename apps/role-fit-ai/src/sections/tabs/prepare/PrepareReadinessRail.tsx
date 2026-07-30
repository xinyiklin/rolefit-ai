import { Check, Circle, ClipboardCheck, LoaderCircle, Sparkles } from "lucide-react";

import type { Application } from "../../../hooks/useApplications";
import type { PreparationReadiness } from "../../../lib/preparationReadiness";

type PrepareReadinessRailProps = {
  progressRunning: boolean;
  preparationHeadline: string;
  preparationDetail: string;
  linkedApplication: Application | null;
  readiness: PreparationReadiness;
  isApplying: boolean;
  onApply: () => void | Promise<void>;
};

export function PrepareReadinessRail({
  progressRunning,
  preparationHeadline,
  preparationDetail,
  linkedApplication,
  readiness,
  isApplying,
  onApply
}: PrepareReadinessRailProps) {
  const reviewSnapshot = linkedApplication?.review;
  const hasSavedResume = Boolean(
    linkedApplication?.resumeArtifacts?.hasSource || linkedApplication?.resumeArtifacts?.hasPdf
  );
  const hasSavedCoverLetter = Boolean(
    linkedApplication?.coverLetterArtifacts?.hasSource || linkedApplication?.coverLetterArtifacts?.hasPdf
  );

  return (
    <aside className="prepare-rail" aria-label="Application readiness">
      <section className={`prepare-progress${progressRunning ? " is-running" : ""}`}>
        <span aria-hidden="true">
          {progressRunning ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}
        </span>
        <div>
          <p className="prepare-page__eyebrow">Preparation</p>
          <h3>{preparationHeadline}</h3>
          <p>{preparationDetail}</p>
        </div>
      </section>

      <section className="prepare-package">
        <div className="prepare-package__head">
          <p className="prepare-page__eyebrow">Package readiness</p>
          <strong>{readiness.canApply ? "Ready to apply" : "In progress"}</strong>
        </div>
        <div className="prepare-checks">
          {Object.values(readiness.checks).map((check) => (
            <div className={`prepare-check is-${check.status}`} key={check.key}>
              <span aria-hidden="true">
                {check.status === "working" ? (
                  <LoaderCircle className="spin" size={14} />
                ) : check.status === "excluded" ? (
                  <Circle size={9} />
                ) : check.ready ? (
                  <Check size={14} />
                ) : (
                  <Circle size={9} />
                )}
              </span>
              <div>
                <strong>{check.label}</strong>
                <p>{check.detail}</p>
              </div>
            </div>
          ))}
        </div>

        {linkedApplication ? (
          <div className="prepare-restored">
            <p className="prepare-page__eyebrow">Saved application</p>
            <strong>{linkedApplication.title}</strong>
            <p>
              {hasSavedResume ? "Resume saved" : "No saved resume"}
              {" · "}
              {hasSavedCoverLetter ? "Cover letter saved" : "No saved cover letter"}
            </p>
            {reviewSnapshot ? (
              <>
                <p>Saved review: {reviewSnapshot.verdict.replace(/_/g, " ").toLowerCase()}</p>
                {reviewSnapshot.recommendation.reason ? <p>{reviewSnapshot.recommendation.reason}</p> : null}
                <p>Historical Apply snapshot; rerun Review after document changes.</p>
              </>
            ) : null}
          </div>
        ) : null}

        <button
          className="primary-button prepare-apply"
          type="button"
          onClick={() => void onApply()}
          disabled={!readiness.canApply || isApplying}
          title={readiness.canApply ? "Mark as applied and save included materials" : readiness.primaryBlocker}
        >
          {isApplying ? (
            <LoaderCircle className="spin" size={15} aria-hidden="true" />
          ) : (
            <ClipboardCheck size={15} aria-hidden="true" />
          )}
          {isApplying ? "Applying…" : "Apply"}
        </button>
        {!readiness.canApply ? <p className="prepare-apply-hint">{readiness.primaryBlocker}</p> : null}
      </section>
    </aside>
  );
}
