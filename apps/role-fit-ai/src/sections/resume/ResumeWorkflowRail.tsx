import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";

import type { ResumeEditorActions } from "../../hooks/useResumeEditor";
import type { AiStageState, PolishProgressState } from "../../lib/aiWorkflow";
import type { PolishedResume } from "../../resumeEngine";
import type { TailorChangeTarget } from "../../resume/types";
import type { FinalCheckResult } from "../../../shared/finalCheckContract.ts";
import {
  DocumentWorkflowRail,
  type DocumentWorkflowCheck,
  type DocumentWorkflowPhase
} from "../document/DocumentWorkflowRail";
import { ResumeProposalReview } from "./ResumeProposalReview";
import { FinalCheckPanel } from "./FinalCheckPanel";

type ResumeWorkflowRailProps = {
  result: PolishedResume | null;
  resume: ResumeData;
  actions: ResumeEditorActions;
  proposalStale?: boolean;
  jobTarget?: { role?: string; company?: string } | null;
  resumeReady: boolean;
  jobReady: boolean;
  tailorProviderReady: boolean;
  finalCheckProviderReady: boolean;
  finalCheckProviderMessage: string;
  selectedSectionCount: number;
  tailorSectionCount: number;
  isPolishing: boolean;
  progress: PolishProgressState;
  status?: string;
  finalCheck: FinalCheckResult | null;
  finalCheckStale: boolean;
  finalCheckProgress: AiStageState;
  finalCheckStatus: string;
  isChecking: boolean;
  onRetryTailor: () => void;
  onStop: () => void;
  onRunFinalCheck: () => void;
  onStopFinalCheck: () => void;
  onHighlight: (target: TailorChangeTarget | null) => void;
};

function readiness(label: string, ready: boolean, detail: string): DocumentWorkflowCheck {
  return { label, state: ready ? "ready" : "blocked", detail: ready ? "Ready" : detail };
}

export function ResumeWorkflowRail({
  result,
  resume,
  actions,
  proposalStale,
  jobTarget,
  resumeReady,
  jobReady,
  tailorProviderReady,
  finalCheckProviderReady,
  finalCheckProviderMessage,
  selectedSectionCount,
  tailorSectionCount,
  isPolishing,
  progress,
  status,
  finalCheck,
  finalCheckStale,
  finalCheckProgress,
  finalCheckStatus,
  isChecking,
  onRetryTailor,
  onStop,
  onRunFinalCheck,
  onStopFinalCheck,
  onHighlight
}: ResumeWorkflowRailProps) {
  const proposalResult = result?.polishOutcome ? result : null;
  const target = [jobTarget?.role, jobTarget?.company].filter(Boolean).join(" at ") || "Resume";
  const ready = resumeReady && jobReady && tailorProviderReady && tailorSectionCount > 0;
  const failed = progress.tailor.status === "failed" || progress.tailor.status === "stopped";
  const withheld = proposalResult?.polishOutcome === "WITHHELD";
  let phase: DocumentWorkflowPhase = ready ? "ready" : "blocked";
  let description = ready
    ? "Polish creates one evidence-grounded proposal for the selected sections."
    : "Complete the blocked rows before polishing.";

  if (isPolishing) {
    phase = "working";
    description = "Creating grounded edits. Your current resume remains unchanged.";
  } else if (proposalResult && proposalStale) {
    phase = "stale";
    description = "The resume or prepared job changed. Polish again for a current proposal.";
  } else if (withheld) {
    phase = "blocked";
    description = "The generated edits could not be verified. Your resume is unchanged.";
  } else if (failed) {
    phase = "blocked";
    description = "No proposal replaced your resume. Retry when ready.";
  } else if (proposalResult?.polishOutcome === "PROPOSAL") {
    phase = "proposal";
    description = `${proposalResult.suggestedChanges?.length ?? 0} edit${proposalResult.suggestedChanges?.length === 1 ? "" : "s"} ready for your decision.`;
  } else if (proposalResult?.polishOutcome === "NO_CHANGES") {
    phase = "ready";
    description = "No safe material changes were suggested.";
  }

  const checks = [
    readiness("Resume", resumeReady, "Add your resume"),
    readiness("Prepared job", jobReady, "Prepare the job"),
    readiness("Polish provider", tailorProviderReady, "Check AI settings"),
    readiness(
      "Sections selected",
      tailorSectionCount > 0,
      selectedSectionCount > 0
        ? `${selectedSectionCount} included · ${tailorSectionCount} tailored`
        : "Mark at least one section Polish"
    )
  ];
  const canRunFinalCheck = resumeReady && jobReady && finalCheckProviderReady && !isPolishing;
  const finalCheckBlocker = !resumeReady
    ? "Add your resume first."
    : !jobReady
      ? "Prepare the job first."
      : !finalCheckProviderReady
        ? finalCheckProviderMessage || "Check Final Check settings."
        : isPolishing
          ? "Wait for Resume Polish to finish."
          : "";
  const failure = failed && !withheld ? {
    title: progress.tailor.errorHeadline || "Polish failed",
    message: "No proposal was created. Your resume was not changed.",
    items: progress.tailor.error ? [progress.tailor.error] : undefined
  } : null;
  const footer = isPolishing ? (
    <button type="button" className="secondary-button is-compact" onClick={onStop}>Stop</button>
  ) : failed ? (
    <button type="button" className="primary-button is-compact" onClick={onRetryTailor}>Retry Polish</button>
  ) : null;

  return (
    <DocumentWorkflowRail
      ariaLabel="Resume workflow"
      phase={phase}
      target={target}
      description={description}
      checks={proposalResult ? [] : checks}
      failure={failure}
      footer={footer}
      status={status}
    >
      {isPolishing || progress.tailor.status !== "idle" ? (
        <div className={`resume-workflow__single-step is-${withheld ? "withheld" : progress.tailor.status}`}>
          <span>Create resume proposal</span>
          <small>{withheld ? "withheld" : proposalResult?.polishOutcome === "NO_CHANGES" ? "no changes" : progress.tailor.status}</small>
        </div>
      ) : null}
      {proposalResult ? (
        <ResumeProposalReview
          result={proposalResult}
          resume={resume}
          actions={actions}
          onHighlight={onHighlight}
        />
      ) : null}
      <FinalCheckPanel
        result={finalCheck}
        stale={finalCheckStale}
        progress={finalCheckProgress}
        status={finalCheckStatus}
        canRun={canRunFinalCheck}
        isChecking={isChecking}
        blocker={finalCheckBlocker}
        onRun={onRunFinalCheck}
        onStop={onStopFinalCheck}
      />
    </DocumentWorkflowRail>
  );
}
