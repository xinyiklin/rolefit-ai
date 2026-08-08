import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";

import type { ResumeEditorActions } from "../../hooks/useResumeEditor";
import type { PolishProgressState } from "../../lib/aiWorkflow";
import type { JobConstraint } from "../../lib/jobConstraints";
import type { PolishedResume, ResumeDiff } from "../../resumeEngine";
import type { TailorChangeTarget } from "../../resume/types";
import { ReviewRail } from "../ReviewRail";
import {
  DocumentWorkflowRail,
  type DocumentWorkflowCheck,
  type DocumentWorkflowPhase
} from "../document/DocumentWorkflowRail";

type ResumeWorkflowRailProps = {
  result: PolishedResume | null;
  resume: ResumeData;
  actions: ResumeEditorActions;
  resumeDiff: ResumeDiff | null;
  jobConstraints?: JobConstraint[];
  reviewStale?: boolean;
  jobTarget?: { role?: string; company?: string } | null;
  resumeReady: boolean;
  jobReady: boolean;
  tailorProviderReady: boolean;
  auditProviderReady: boolean;
  polishStages: "tailor" | "review" | "both";
  selectedSectionCount: number;
  tailorSectionCount: number;
  isPolishing: boolean;
  progress: PolishProgressState;
  status?: string;
  onRetryTailor: () => void;
  onRetryAudit: () => void;
  onStop: () => void;
  onHighlight: (target: TailorChangeTarget | null) => void;
  onProposalChange: () => void;
  onAddHonestContext?: (keyword: string) => void;
};

function readiness(label: string, ready: boolean, detail: string): DocumentWorkflowCheck {
  return { label, state: ready ? "ready" : "blocked", detail: ready ? "Ready" : detail };
}

function stepClass(status: string): string {
  if (status === "done") return "is-done";
  if (status === "running") return "is-running";
  if (status === "failed" || status === "stopped") return "is-failed";
  return "is-idle";
}

export function ResumeWorkflowRail({
  result,
  resume,
  actions,
  resumeDiff,
  jobConstraints,
  reviewStale,
  jobTarget,
  resumeReady,
  jobReady,
  tailorProviderReady,
  auditProviderReady,
  polishStages,
  selectedSectionCount,
  tailorSectionCount,
  isPolishing,
  progress,
  status,
  onRetryTailor,
  onRetryAudit,
  onStop,
  onHighlight,
  onProposalChange,
  onAddHonestContext
}: ResumeWorkflowRailProps) {
  const target = [jobTarget?.role, jobTarget?.company].filter(Boolean).join(" at ") || "Resume";
  const needsTailor = polishStages !== "review";
  const needsAudit = polishStages !== "tailor";
  const ready =
    resumeReady &&
    jobReady &&
    (!needsTailor || tailorProviderReady) &&
    (!needsAudit || auditProviderReady) &&
    (!needsTailor || tailorSectionCount > 0);
  const tailorFailed =
    needsTailor && (progress.tailor.status === "failed" || progress.tailor.status === "stopped");
  const auditFailed =
    needsAudit && (progress.review.status === "failed" || progress.review.status === "stopped");
  const auditedCurrentResume = progress.tailor.status === "idle" && progress.review.status === "done";
  const readyDescription =
    polishStages === "tailor"
      ? "Polish creates evidence-grounded edits for the selected sections."
      : polishStages === "review"
        ? "Polish audits the current resume without creating tailoring edits."
        : "Polish runs Tailor on selected sections, then audits the complete proposal.";

  let phase: DocumentWorkflowPhase = ready ? "ready" : "blocked";
  let description = ready ? readyDescription : "Complete the blocked rows before polishing.";
  if (isPolishing) {
    phase = "working";
    description =
      polishStages === "review"
        ? "Recruiter audit is evaluating the current resume."
        : progress.review.status === "running"
          ? "Tailoring finished. Recruiter audit is evaluating the complete proposal."
          : "Creating evidence-grounded edits before the recruiter audit.";
  } else if (result && reviewStale) {
    phase = "stale";
    description = "The resume or prepared job changed. Polish again for a current verdict.";
  } else if (tailorFailed || auditFailed) {
    phase = "blocked";
    description = tailorFailed
      ? "No proposal was created. Your resume was not changed."
      : "The proposed edits were preserved, but the recruiter audit did not complete.";
  } else if (result) {
    phase = auditedCurrentResume ? "audit" : "proposal";
    description = auditedCurrentResume
      ? "Recruiter audit of the current edited resume. No tailoring changes were proposed."
      : result.strictReview
        ? "Audit of complete proposal. Accept, edit, or discard each proposed change."
        : "Grounded edits are ready for your decision. This proposal has not been audited.";
  }

  // Every row is a real gate on Polish — what the workflow does with them is the
  // description's job, so nothing here is an always-ready explanation.
  const checks = [
    readiness("Resume", resumeReady, "Add your resume"),
    readiness("Prepared job", jobReady, "Prepare the job"),
    ...(needsTailor
      ? [readiness("Polish provider", tailorProviderReady, "Check AI settings")]
      : []),
    ...(needsAudit
      ? [readiness("Audit provider", auditProviderReady, "Check AI settings")]
      : []),
    ...(needsTailor
      ? [readiness(
          "Sections selected",
          tailorSectionCount > 0,
          selectedSectionCount > 0
            ? `${selectedSectionCount} included · ${tailorSectionCount} tailored`
            : "Mark at least one section Tailor"
        )]
      : [])
  ];

  const failedStage = tailorFailed ? progress.tailor : auditFailed ? progress.review : null;
  const failure = failedStage ? {
    title: failedStage.errorHeadline || (tailorFailed ? "Tailoring failed" : "Recruiter audit failed"),
    message: tailorFailed
      ? "No proposal was created. Your resume was not changed."
      : "The proposed edits were preserved. Review them now or retry the audit.",
    items: failedStage.error ? [failedStage.error] : undefined
  } : null;

  // Polish itself lives beside the rail's disclosure control, in the header. The
  // footer carries only what a run's outcome adds: stopping it, or retrying the
  // stage that failed.
  const footer = isPolishing ? (
    <button type="button" className="secondary-button is-compact" onClick={onStop}>Stop</button>
  ) : tailorFailed ? (
    <button type="button" className="primary-button is-compact" onClick={onRetryTailor}>Retry tailor</button>
  ) : auditFailed ? (
    <button type="button" className="primary-button is-compact" onClick={onRetryAudit}>Retry audit</button>
  ) : null;

  return (
    <DocumentWorkflowRail
      ariaLabel="Resume workflow"
      phase={phase}
      target={target}
      description={description}
      checks={result ? [] : checks}
      failure={failure}
      footer={footer}
      status={status}
    >
      {isPolishing ||
      (needsTailor && progress.tailor.status !== "idle") ||
      (needsAudit && progress.review.status !== "idle") ? (
        <ol className="resume-workflow__steps" aria-label="Polish resume progress">
          {needsTailor ? (
            <li className={stepClass(progress.tailor.status)}>
              <span>Tailor selected sections</span>
              <small>{progress.tailor.status}</small>
            </li>
          ) : null}
          {needsAudit ? (
            <li className={stepClass(progress.review.status)}>
              <span>Recruiter audit</span>
              <small>{tailorFailed && progress.review.status === "idle" ? "Not run" : progress.review.status}</small>
            </li>
          ) : null}
        </ol>
      ) : null}

      {result ? (
        <ReviewRail
          result={result}
          resume={resume}
          actions={actions}
          resumeDiff={resumeDiff}
          jobConstraints={jobConstraints}
          reviewStale={reviewStale}
          onHighlight={onHighlight}
          onProposalChange={onProposalChange}
          onAddHonestContext={onAddHonestContext}
        />
      ) : null}
    </DocumentWorkflowRail>
  );
}
