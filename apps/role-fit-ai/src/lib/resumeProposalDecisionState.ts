import { stripInlineMarks } from "@typeset/engine/lib/inlineMarksText.ts";

import type { PolishedResume, ResumeProposalSuggestion } from "../resume/types.ts";

export type ResumeProposalDecision =
  | { kind: "accepted"; text: string }
  | { kind: "discarded" };

export type ResumeProposalDecisionState = {
  proposalKey: string;
  byTargetId: Record<string, ResumeProposalDecision>;
};

const EMPTY_DECISIONS: Readonly<Record<string, ResumeProposalDecision>> = Object.freeze({});

function normalize(value: string): string {
  return stripInlineMarks(value).replace(/\s+/g, " ").trim().toLowerCase();
}

export function resumeProposalKey(result: PolishedResume | null): string {
  return JSON.stringify({
    outcome: result?.polishOutcome ?? "",
    changes: (result?.suggestedChanges ?? []).map((suggestion) => ({
      targetId: suggestion.id,
      target: suggestion.target,
      originalText: suggestion.currentText,
      proposedText: suggestion.proposedText,
      reason: suggestion.reason || ""
    }))
  });
}

export function decisionsForProposal(
  state: ResumeProposalDecisionState,
  proposalKey: string
): Readonly<Record<string, ResumeProposalDecision>> {
  return state.proposalKey === proposalKey ? state.byTargetId : EMPTY_DECISIONS;
}

export function recordProposalDecision(
  state: ResumeProposalDecisionState,
  proposalKey: string,
  targetId: string,
  decision: ResumeProposalDecision
): ResumeProposalDecisionState {
  const byTargetId = state.proposalKey === proposalKey ? state.byTargetId : EMPTY_DECISIONS;
  return {
    proposalKey,
    byTargetId: { ...byTargetId, [targetId]: decision }
  };
}

export function resumeProposalEditIsPending(
  currentText: string | null,
  suggestion: ResumeProposalSuggestion,
  decision?: ResumeProposalDecision
): boolean {
  if (decision?.kind === "discarded") return false;
  return currentText !== null && normalize(currentText) === normalize(suggestion.currentText);
}
