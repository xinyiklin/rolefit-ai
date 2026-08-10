import { stripInlineMarks } from "@typeset/engine/lib/inlineMarksText.ts";

import type { PolishedResume, ResumeProposalSuggestion } from "../resume/types.ts";

export type ResumeProposalDecision =
  | { kind: "accepted"; text: string }
  | { kind: "discarded" };

export type ResumeProposalDecisionState = {
  proposalKey: string;
  byTargetId: Record<string, ResumeProposalDecision>;
};

export type ResumeProposalEditState = "pending" | "accepted" | "discarded" | "changed";

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

// Undo for one row. Clearing the record is only half of it for an accepted
// edit — the caller restores the original text first, and this returns the row
// to the pending set so it can be decided again.
export function clearProposalDecision(
  state: ResumeProposalDecisionState,
  proposalKey: string,
  targetId: string
): ResumeProposalDecisionState {
  if (state.proposalKey !== proposalKey || !(targetId in state.byTargetId)) return state;
  const byTargetId = { ...state.byTargetId };
  delete byTargetId[targetId];
  return { proposalKey, byTargetId };
}

export function resumeProposalEditIsPending(
  currentText: string | null,
  suggestion: ResumeProposalSuggestion,
  decision?: ResumeProposalDecision
): boolean {
  return resumeProposalEditState(currentText, suggestion, decision) === "pending";
}

export function resumeProposalEditState(
  currentText: string | null,
  suggestion: ResumeProposalSuggestion,
  decision?: ResumeProposalDecision
): ResumeProposalEditState {
  if (currentText === null) return "changed";
  const current = normalize(currentText);
  if (decision?.kind === "accepted") {
    return current === normalize(decision.text) ? "accepted" : "changed";
  }
  if (decision?.kind === "discarded") {
    return current === normalize(suggestion.currentText) ? "discarded" : "changed";
  }
  if (current === normalize(suggestion.currentText)) return "pending";
  if (current === normalize(suggestion.proposedText)) return "accepted";
  return "changed";
}
