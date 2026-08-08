import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";

import type { useResumeProposalDecisions } from "../../hooks/useResumeProposalDecisions";
import type { DocumentCheckSource } from "../../hooks/useDocumentCheck";
import type { AiStageState, PolishProgressState } from "../../lib/aiWorkflow";
import type { PolishedResume } from "../../resumeEngine";
import type { ResumeProposalTarget } from "../../resume/types";
import type { FinalCheckResult } from "../../../shared/finalCheckContract.ts";
import { resolveDocumentWorkflowStatus } from "../../../shared/documentWorkflowContract.ts";
import {
  DocumentWorkflowRail,
  type DocumentWorkflowCheck
} from "../document/DocumentWorkflowRail";
import { DocumentCheckSummary } from "../document/DocumentCheckSummary";
import { ResumeProposalReview } from "./ResumeProposalReview";

type ResumeWorkflowRailProps = {
  result: PolishedResume | null;
  resume: ResumeData;
  decisions: ReturnType<typeof useResumeProposalDecisions>;
  proposalStale?: boolean;
  jobTarget?: { role?: string; company?: string } | null;
  resumeReady: boolean;
  jobReady: boolean;
  resumePolishProviderReady: boolean;
  checkProviderReady: boolean;
  checkProviderMessage: string;
  selectedSectionCount: number;
  polishSectionCount: number;
  isPolishing: boolean;
  progress: PolishProgressState;
  status?: string;
  check: FinalCheckResult | null;
  checkSource: DocumentCheckSource;
  checkDocumentChanged: boolean;
  checkInputsChanged: boolean;
  checkProgress: AiStageState;
  isChecking: boolean;
  onRetryPolish: () => void;
  onStop: () => void;
  onCheck: () => void;
  onStopCheck: () => void;
  onHighlight: (target: ResumeProposalTarget | null) => void;
};

function readiness(label: string, ready: boolean, detail: string): DocumentWorkflowCheck {
  return { label, state: ready ? "ready" : "blocked", detail: ready ? "Ready" : detail };
}

export function ResumeWorkflowRail({
  result,
  resume,
  decisions,
  proposalStale,
  jobTarget,
  resumeReady,
  jobReady,
  resumePolishProviderReady,
  checkProviderReady,
  checkProviderMessage,
  selectedSectionCount,
  polishSectionCount,
  isPolishing,
  progress,
  status,
  check,
  checkSource,
  checkDocumentChanged,
  checkInputsChanged,
  checkProgress,
  isChecking,
  onRetryPolish,
  onStop,
  onCheck,
  onStopCheck,
  onHighlight
}: ResumeWorkflowRailProps) {
  const proposalResult = result?.polishOutcome ? result : null;
  const target = [jobTarget?.role, jobTarget?.company].filter(Boolean).join(" at ") || "Resume";
  const ready = resumeReady && jobReady && resumePolishProviderReady && polishSectionCount > 0;
  const failed = progress.polish.status === "failed" || progress.polish.status === "stopped";
  const withheld = proposalResult?.polishOutcome === "WITHHELD";

  // A proposal is only "outstanding" while edits still need a decision. Once
  // they settle, the workflow moves on to the current-resume check rather than
  // parking on a proposal the user has finished with.
  const workflow = resolveDocumentWorkflowStatus({
    ready,
    polishing: isPolishing,
    checking: isChecking,
    proposal: proposalResult && decisions.outstanding > 0
      ? { outstanding: decisions.outstanding, total: decisions.total }
      : null,
    proposalSuperseded: Boolean(proposalResult && proposalStale),
    check: check?.status ?? null,
    checkDocumentChanged,
    checkInputsChanged
  });

  const description = isPolishing
    ? "Creating evidence-grounded resume edits. Your current resume remains unchanged."
    : workflow.state === "checking"
      ? "Reviewing the resulting document for evidence, coverage, and clarity."
      : workflow.state === "proposal"
        ? `${decisions.total} edit${decisions.total === 1 ? "" : "s"} waiting for your decision.`
        : workflow.state === "reviewing"
          ? `${decisions.outstanding} of ${decisions.total} edits still need a decision.`
          : withheld
            ? "The generated edits could not be verified. Your resume is unchanged."
            : failed
              ? "No proposal replaced your resume. Retry when ready."
              : workflow.state === "stale" && workflow.staleReason === "proposal-superseded"
                ? "The resume or prepared job changed. Polish again for a current proposal."
                : workflow.state === "ready-to-polish"
                  ? "Polish creates one evidence-grounded proposal, then checks the resulting resume."
                  : workflow.state === "blocked"
                    ? "Complete the blocked rows before polishing."
                    : "";

  const checks = [
    readiness("Resume", resumeReady, "Add your resume"),
    readiness("Prepared job", jobReady, "Prepare the job"),
    readiness("Polish provider", resumePolishProviderReady, "Check AI settings"),
    readiness(
      "Sections selected",
      polishSectionCount > 0,
      selectedSectionCount > 0
        ? `${selectedSectionCount} included · ${polishSectionCount} selected for Polish`
        : "Mark at least one section Polish"
    )
  ];
  const canCheck = resumeReady && jobReady && checkProviderReady && !isPolishing;
  const checkBlocker = !resumeReady
    ? "Add your resume first."
    : !jobReady
      ? "Prepare the job first."
      : !checkProviderReady
        ? checkProviderMessage || "Check the AI settings for this stage."
        : isPolishing
          ? "Wait for Polish to finish."
          : "";
  const failure = failed && !withheld ? {
    title: progress.polish.errorHeadline || "Polish failed",
    message: "No proposal was created. Your resume was not changed.",
    items: progress.polish.error ? [progress.polish.error] : undefined
  } : null;
  const footer = isPolishing ? (
    <button type="button" className="secondary-button is-compact" onClick={onStop}>Stop</button>
  ) : failed ? (
    <button type="button" className="primary-button is-compact" onClick={onRetryPolish}>Retry Polish</button>
  ) : null;

  return (
    <DocumentWorkflowRail
      ariaLabel="Resume workflow"
      status={workflow}
      target={target}
      description={description}
      checks={proposalResult ? [] : checks}
      failure={failure}
      footer={footer}
      statusLine={status}
    >
      {proposalResult ? (
        <ResumeProposalReview
          result={proposalResult}
          resume={resume}
          decisions={decisions}
          onHighlight={onHighlight}
        />
      ) : null}
      <DocumentCheckSummary
        documentNoun="resume"
        check={check}
        source={checkSource}
        staleReason={workflow.state === "stale" ? workflow.staleReason : undefined}
        progress={checkProgress}
        isChecking={isChecking}
        canCheck={canCheck}
        blocker={checkBlocker}
        onCheck={onCheck}
        onStop={onStopCheck}
      />
    </DocumentWorkflowRail>
  );
}
