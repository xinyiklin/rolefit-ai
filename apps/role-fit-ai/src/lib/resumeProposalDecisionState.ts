import { stripInlineMarks } from "@typeset/engine/lib/inlineMarksText.ts";

import type { PolishedResume, ResumeProposalSuggestion } from "../resume/types.ts";

export type ResumeProposalDecision =
  | { kind: "accepted"; text: string }
  | { kind: "discarded" };

export type ResumeProposalDecisionState = {
  proposalKey: string;
  byTargetId: Record<string, ResumeProposalDecision>;
  // Held-back edits the user returned to the proposal. They live under the same
  // key as decisions, so a Restore never resets accepted rows or their Undo.
  restored?: Readonly<Record<string, true>>;
};

export type ResumeProposalEditState = "pending" | "accepted" | "discarded" | "changed";

const EMPTY_DECISIONS: Readonly<Record<string, ResumeProposalDecision>> = Object.freeze({});
const EMPTY_RESTORED: Readonly<Record<string, true>> = Object.freeze({});

function normalize(value: string): string {
  return stripInlineMarks(value).replace(/\s+/g, " ").trim().toLowerCase();
}

// What a row compares with the live document: its text, or a reorder's bullet ids.
export function proposalBaseline(suggestion: ResumeProposalSuggestion): string {
  return suggestion.kind === "reorder" ? (suggestion.originalOrder ?? []).join("\n") : suggestion.currentText;
}

export function proposalValue(suggestion: ResumeProposalSuggestion): string {
  return suggestion.kind === "reorder" ? (suggestion.proposedOrder ?? []).join("\n") : suggestion.proposedText;
}

function suggestionIdentity(suggestion: ResumeProposalSuggestion) {
  return {
    targetId: suggestion.id,
    kind: suggestion.kind ?? "",
    target: suggestion.target,
    originalOrder: suggestion.originalOrder ?? [],
    proposedOrder: suggestion.proposedOrder ?? [],
    originalText: suggestion.currentText,
    proposedText: suggestion.proposedText,
    reason: suggestion.reason || ""
  };
}

// Held-back edits are part of the payload's identity from arrival, so restoring
// one changes the visible list without changing the key.
export function resumeProposalKey(result: PolishedResume | null): string {
  return JSON.stringify({
    runId: result?.runId ?? "",
    outcome: result?.polishOutcome ?? "",
    changes: (result?.suggestedChanges ?? []).map(suggestionIdentity),
    ...(result?.review ? {
      review: result.review,
      heldBack: (result.heldBack ?? []).map(({ suggestion, reason }) => ({ ...suggestionIdentity(suggestion), heldBackReason: reason }))
    } : {})
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
  const sameProposal = state.proposalKey === proposalKey;
  const byTargetId = sameProposal ? state.byTargetId : EMPTY_DECISIONS;
  return {
    proposalKey,
    byTargetId: { ...byTargetId, [targetId]: decision },
    ...(sameProposal && state.restored ? { restored: state.restored } : {})
  };
}

export function restoredForProposal(
  state: ResumeProposalDecisionState,
  proposalKey: string
): Readonly<Record<string, true>> {
  return state.proposalKey === proposalKey ? state.restored ?? EMPTY_RESTORED : EMPTY_RESTORED;
}

export function recordProposalRestore(
  state: ResumeProposalDecisionState,
  proposalKey: string,
  targetId: string
): ResumeProposalDecisionState {
  const sameProposal = state.proposalKey === proposalKey;
  return {
    proposalKey,
    byTargetId: sameProposal ? state.byTargetId : EMPTY_DECISIONS,
    restored: { ...(sameProposal ? state.restored : undefined), [targetId]: true }
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
  return { ...state, byTargetId };
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
  const key = suggestion.kind === "reorder" ? (value: string) => value : normalize;
  const current = key(currentText);
  if (decision?.kind === "accepted") {
    return current === key(decision.text) ? "accepted" : "changed";
  }
  if (decision?.kind === "discarded") {
    return current === key(proposalBaseline(suggestion)) ? "discarded" : "changed";
  }
  if (current === key(proposalBaseline(suggestion))) return "pending";
  if (current === key(proposalValue(suggestion))) return "accepted";
  return "changed";
}
