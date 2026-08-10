import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";

import type { useResumeProposalDecisions } from "../../hooks/useResumeProposalDecisions";
import type { PolishProgressState } from "../../lib/aiWorkflow";
import type { PolishedResume } from "../../resumeEngine";
import type { ResumeProposalTarget } from "../../resume/types";
import { resolveDocumentWorkflowStatus } from "../../../shared/documentWorkflowContract.ts";
import {
  DocumentWorkflowRail,
  type DocumentWorkflowCheck
} from "../document/DocumentWorkflowRail";
import { ProposalDecisionBar } from "../document/ProposalDecisionBar";
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
  selectedSectionCount: number;
  polishSectionCount: number;
  isPolishing: boolean;
  progress: PolishProgressState;
  status?: string;
  onRetryPolish: () => void;
  onStop: () => void;
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
  selectedSectionCount,
  polishSectionCount,
  isPolishing,
  progress,
  status,
  onRetryPolish,
  onStop,
  onHighlight
}: ResumeWorkflowRailProps) {
  const proposalResult = result?.polishOutcome ? result : null;
  const target = [jobTarget?.role, jobTarget?.company].filter(Boolean).join(" at ") || "Resume";
  const ready = resumeReady && jobReady && resumePolishProviderReady && polishSectionCount > 0;
  const failed = progress.polish.status === "failed" || progress.polish.status === "stopped";
  const withheld = proposalResult?.polishOutcome === "WITHHELD";

  // A proposal is only "outstanding" while edits still need a decision.
  const workflow = resolveDocumentWorkflowStatus({
    ready,
    polishing: isPolishing,
    proposal: proposalResult && decisions.outstanding > 0
      ? { outstanding: decisions.outstanding, total: decisions.total }
      : null,
    proposalSuperseded: Boolean(proposalResult && proposalStale),
  });

  // The footer's decision bar carries the count, so the description says what
  // accepting means rather than repeating the same numbers one line above it.
  const description = isPolishing
    ? "Creating evidence-grounded resume edits. Your current resume remains unchanged."
    : workflow.state === "proposal" || workflow.state === "reviewing"
        ? "Your resume changes only for the edits you accept."
        : withheld
            ? "The generated edits could not be verified. Your resume is unchanged."
            : failed
              ? "No proposal replaced your resume. Retry when ready."
              : workflow.state === "stale" && workflow.staleReason === "proposal-superseded"
                ? "The resume or prepared job changed. Polish again for a current proposal."
                : workflow.state === "ready-to-polish"
                  ? "Polish creates one evidence-grounded proposal for you to review."
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
  const failure = failed && !withheld ? {
    title: progress.polish.errorHeadline || "Polish failed",
    message: "No proposal was created. Your resume was not changed.",
    items: progress.polish.error ? [progress.polish.error] : undefined
  } : null;
  // Both documents commit from the same place with the same verbs; only the
  // unit differs — the resume decides N edits, the letter decides one letter.
  const footer = isPolishing ? (
    <button type="button" className="secondary-button is-compact" onClick={onStop}>Stop</button>
  ) : failed ? (
    <button type="button" className="primary-button is-compact" onClick={onRetryPolish}>Retry Polish</button>
  ) : proposalResult && decisions.total > 0 ? (
    <ProposalDecisionBar
      summary={decisions.outstanding
        ? `${decisions.outstanding} of ${decisions.total} edit${decisions.total === 1 ? "" : "s"} left to decide`
        : `All ${decisions.total} edit${decisions.total === 1 ? "" : "s"} decided`}
      progress={{ decided: decisions.decided, total: decisions.total }}
    >
      <button
        type="button"
        className="primary-button is-compact"
        disabled={Boolean(proposalStale) || !decisions.outstanding}
        onClick={decisions.applyAll}
      >
        Accept all{decisions.outstanding ? ` (${decisions.outstanding})` : ""}
      </button>
      <button
        type="button"
        className="secondary-button is-compact"
        disabled={!decisions.outstanding}
        onClick={decisions.discardAll}
      >
        Discard all
      </button>
    </ProposalDecisionBar>
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
          key={decisions.proposalKey}
          result={proposalResult}
          resume={resume}
          decisions={decisions}
          proposalStale={Boolean(proposalStale)}
          onHighlight={onHighlight}
        />
      ) : null}
    </DocumentWorkflowRail>
  );
}
