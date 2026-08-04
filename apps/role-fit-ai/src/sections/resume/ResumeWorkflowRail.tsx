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
  selectedSectionCount: number;
  tailorSectionCount: number;
  isPolishing: boolean;
  progress: PolishProgressState;
  status?: string;
  onPolish: () => void;
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
  selectedSectionCount,
  tailorSectionCount,
  isPolishing,
  progress,
  status,
  onPolish,
  onRetryTailor,
  onRetryAudit,
  onStop,
  onHighlight,
  onProposalChange,
  onAddHonestContext
}: ResumeWorkflowRailProps) {
  const target = [jobTarget?.role, jobTarget?.company].filter(Boolean).join(" at ") || "Resume workflow";
  const ready = resumeReady && jobReady && tailorProviderReady && auditProviderReady && tailorSectionCount > 0;
  const tailorFailed = progress.tailor.status === "failed" || progress.tailor.status === "stopped";
  const auditFailed = progress.review.status === "failed" || progress.review.status === "stopped";
  const auditedCurrentResume = progress.tailor.status === "idle" && progress.review.status === "done";

  let phase: DocumentWorkflowPhase = ready ? "ready" : "blocked";
  let description = ready
    ? "One click tailors selected sections, then audits the complete proposal."
    : "Complete the blocked rows before polishing.";
  if (isPolishing) {
    phase = "working";
    description = progress.review.status === "running"
      ? "Tailoring finished. Recruiter audit is evaluating the complete proposal."
      : "Creating evidence-grounded edits before the recruiter audit.";
  } else if (result && reviewStale) {
    phase = "stale";
    description = "The resume or prepared job changed. Audit again for a current verdict.";
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

  const checks = [
    readiness("Resume", resumeReady, "Add resume evidence"),
    readiness("Prepared job", jobReady, "Prepare the job"),
    readiness("Tailor provider", tailorProviderReady, "Check AI settings"),
    readiness("Audit provider", auditProviderReady, "Check AI settings"),
    readiness(
      "Sections selected",
      tailorSectionCount > 0,
      selectedSectionCount > 0
        ? `${selectedSectionCount} included · ${tailorSectionCount} tailored`
        : "Choose Tailor or Include"
    ),
    { label: "Workflow", state: "ready", detail: "Tailor, then audit" } satisfies DocumentWorkflowCheck
  ];

  const failedStage = tailorFailed ? progress.tailor : auditFailed ? progress.review : null;
  const failure = failedStage ? {
    title: failedStage.errorHeadline || (tailorFailed ? "Tailoring failed" : "Recruiter audit failed"),
    message: tailorFailed
      ? "No proposal was created. Your resume was not changed."
      : "The proposed edits were preserved. Review them now or retry the audit.",
    items: failedStage.error ? [failedStage.error] : undefined
  } : null;

  const footer = isPolishing ? (
    <button type="button" className="secondary-button is-compact" onClick={onStop}>Stop</button>
  ) : tailorFailed ? (
    <button type="button" className="primary-button is-compact" onClick={onRetryTailor}>Retry Tailor</button>
  ) : auditFailed ? (
    <button type="button" className="primary-button is-compact" onClick={onRetryAudit}>Retry audit</button>
  ) : (
    <button type="button" className="primary-button is-compact" disabled={!ready} onClick={onPolish}>
      {result ? "Polish again" : "Polish resume"}
    </button>
  );

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
      {isPolishing || progress.tailor.status !== "idle" || progress.review.status !== "idle" ? (
        <ol className="resume-workflow__steps" aria-label="Polish resume progress">
          <li className={stepClass(progress.tailor.status)}>
            <span>Tailor selected sections</span>
            <small>{progress.tailor.status === "idle" && tailorFailed ? "Not run" : progress.tailor.status}</small>
          </li>
          <li className={stepClass(progress.review.status)}>
            <span>Recruiter audit</span>
            <small>{tailorFailed && progress.review.status === "idle" ? "Not run" : progress.review.status}</small>
          </li>
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
