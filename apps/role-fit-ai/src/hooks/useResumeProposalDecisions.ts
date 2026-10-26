import { terminologyCoverage } from "../resume/terminology.ts";
import { serializeResumeData } from "../lib/resumeText.ts";
/**
 * useResumeProposalDecisions — accept / edit / discard state for the resume
 * proposal's individual edits.
 *
 * It used to live inside `ResumeProposalReview`, which was fine while nothing
 * outside that component cared when the user finished. The unified workflow
 * does care: the resulting resume only exists once every edit has a decision.
 * Ownership moved up so the workflow can observe "no decisions outstanding"
 * without the review component owning the decision state.
 *
 * A decision is never the source of truth about the document. `outstanding`
 * re-derives from the LIVE resume every render, so a manual edit that happens
 * to match a proposed replacement counts as decided, and an undo that restores
 * the original text makes the edit pending again.
 */
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";

import {
  clearProposalDecision,
  decisionsForProposal,
  proposalBaseline,
  proposalValue,
  recordProposalDecision,
  recordProposalRestore,
  restoredForProposal,
  resumeFitGapRows,
  resumeProposalEditState,
  resumeProposalEditIsPending,
  resumeProposalKey,
  type ResumeProposalDecisionState
} from "../lib/resumeProposalDecisionState.ts";
import { acceptedTerminologyWarnings, applyRank, applyTarget, currentTargetText } from "../lib/resumeProposalApply.ts";
import type { PolishedResume, ResumeProposalSuggestion } from "../resumeEngine.ts";
import type { ResumeEditorActions } from "./useResumeEditor.ts";

export type { ResumeProposalDecision } from "../lib/resumeProposalDecisionState.ts";

type UseResumeProposalDecisionsArgs = {
  result: PolishedResume | null;
  resume: ResumeData;
  actions: ResumeEditorActions;
  terminologyInputKey?: string;
  // The prepared posting, for the live terminology coverage view.
  jobText?: string;
};

export function useResumeProposalDecisions({
  result,
  resume,
  actions,
  terminologyInputKey,
  jobText = ""
}: UseResumeProposalDecisionsArgs) {
  // Generation is read at call time too, so an action never lands on a replaced document.
  const isDocumentReplaced = useCallback(() => result?.documentGeneration !== undefined
    && result.documentGeneration !== actions.getDocumentGeneration(), [actions, result]);
  const documentReplaced = isDocumentReplaced();
  // Suggestion ids are unique within one proposal but not across proposals, so
  // decisions reset on the proposal's own identity rather than on any single id.
  const proposalKey = useMemo(() => resumeProposalKey(result), [result]);
  const [decisionState, setDecisionState] = useState<ResumeProposalDecisionState>(() => ({
    proposalKey,
    byTargetId: {}
  }));
  // A changed key exposes an empty map immediately without mutating React state
  // during render. The first decision atomically initializes the new key.
  const decisions = decisionsForProposal(decisionState, proposalKey);
  const restored = restoredForProposal(decisionState, proposalKey);
  const heldBackEdits = useMemo(() => result?.heldBack ?? [], [result]);
  // Restored edits join the decidable list; the rest stay held back and are never
  // touched by Accept all or a group's Accept.
  const suggestions = useMemo(() => [
    ...(result?.suggestedChanges ?? []),
    ...heldBackEdits.filter((item) => restored[item.suggestion.id]).map((item) => item.suggestion)
  ], [heldBackEdits, restored, result]);
  const heldBack = useMemo(() => heldBackEdits.filter((item) => !restored[item.suggestion.id]), [heldBackEdits, restored]);

  const isPending = useCallback(
    (suggestion: ResumeProposalSuggestion): boolean => {
      const current = currentTargetText(resume, suggestion);
      return !isDocumentReplaced() && resumeProposalEditIsPending(current, suggestion, decisions[suggestion.id]);
    },
    [decisions, resume, isDocumentReplaced]
  );

  const outstanding = useMemo(
    () => suggestions.filter(isPending).length,
    [isPending, suggestions]
  );

  const accept = useCallback(
    (suggestion: ResumeProposalSuggestion, value = proposalValue(suggestion)) => {
      if ((!suggestion.kind || suggestion.kind === "add") && !value.trim()) return;
      if (!isPending(suggestion)) return;
      applyTarget(resume, actions, suggestion, value);
      setDecisionState((current) => recordProposalDecision(
        current,
        proposalKey,
        suggestion.id,
        { kind: "accepted", text: value }
      ));
    },
    [actions, proposalKey, isPending, resume]
  );

  const discard = useCallback((suggestion: ResumeProposalSuggestion) => {
    setDecisionState((current) => recordProposalDecision(
      current,
      proposalKey,
      suggestion.id,
      { kind: "discarded" }
    ));
  }, [proposalKey]);

  // Undo one decision. An accepted edit put its replacement in the document, so
  // reverting has to put the original back before the row returns to pending;
  // a discarded edit never touched the document and only needs its record gone.
  const revert = useCallback((suggestion: ResumeProposalSuggestion) => {
    if (isDocumentReplaced()) return;
    const decision = decisions[suggestion.id];
    const state = resumeProposalEditState(currentTargetText(resume, suggestion), suggestion, decision);
    if (state !== "accepted" && state !== "discarded") return;
    if (decision?.kind === "accepted") {
      applyTarget(resume, actions, suggestion, proposalBaseline(suggestion));
    }
    setDecisionState((current) => clearProposalDecision(current, proposalKey, suggestion.id));
  }, [actions, decisions, proposalKey, resume, isDocumentReplaced]);

  // Return a held-back edit to the proposal as a pending row. It records state
  // only: the document and the result are untouched.
  const restore = useCallback((suggestionId: string) => {
    if (isDocumentReplaced() || !heldBackEdits.some((item) => item.suggestion.id === suggestionId)) return;
    setDecisionState((current) => recordProposalRestore(current, proposalKey, suggestionId));
  }, [heldBackEdits, isDocumentReplaced, proposalKey]);

  // Accept every pending row, or only `subset` (one operation group).
  const applyAll = useCallback((subset: readonly ResumeProposalSuggestion[] = suggestions) => {
    const pending = subset.filter(isPending).sort((left, right) => applyRank(left) - applyRank(right));
    for (const suggestion of pending) applyTarget(resume, actions, suggestion, proposalValue(suggestion));
    setDecisionState((current) => pending.reduce(
      (next, suggestion) => recordProposalDecision(
        next,
        proposalKey,
        suggestion.id,
        { kind: "accepted", text: proposalValue(suggestion) }
      ),
      current
    ));
  }, [actions, isPending, proposalKey, resume, suggestions]);

  // The counterpart to Accept all, and the reason the resume's bulk pair now
  // reads like the letter's: both documents can decline a whole proposal in one
  // move. It mutates nothing — every discarded row still offers Undo.
  const discardAll = useCallback((subset: readonly ResumeProposalSuggestion[] = suggestions) => {
    const pending = subset.filter(isPending);
    setDecisionState((current) => pending.reduce(
      (next, suggestion) => recordProposalDecision(next, proposalKey, suggestion.id, { kind: "discarded" }),
      current
    ));
  }, [isPending, proposalKey, suggestions]);

  const terminologyWarnings = useMemo(
    () => acceptedTerminologyWarnings(result, terminologyInputKey, suggestions, decisions, resume),
    [decisions, resume, result, suggestions, terminologyInputKey]
  );

  const fitGapRows = useMemo(() => resumeFitGapRows(result, suggestions, (suggestion) => isDocumentReplaced()
    ? "changed"
    : resumeProposalEditState(currentTargetText(resume, suggestion), suggestion, decisions[suggestion.id])
  ), [decisions, isDocumentReplaced, result, resume, suggestions]);

  // A whole-resume scan, so it follows deferred copies and typing in the resume
  // or the brief never waits on it.
  const deferredResume = useDeferredValue(resume);
  const deferredJobText = useDeferredValue(jobText);
  const termCoverage = useMemo(() => result
    ? terminologyCoverage(deferredJobText, serializeResumeData(deferredResume))
    : { onResume: [], relatedOnly: [], notOnResume: [], limitations: [] }, [deferredJobText, deferredResume, result]);

  return {
    documentReplaced,
    terminologyWarnings,
    fitGapRows,
    termCoverage,
    decisions,
    proposalKey,
    suggestions,
    outstanding,
    decided: suggestions.length - outstanding,
    total: suggestions.length,
    // A proposal with no edits to decide (No changes / fully withheld) is
    // settled the moment it arrives; there is nothing for the user to resolve.
    decisionsSettled: Boolean(result?.polishOutcome) && outstanding === 0,
    isPending,
    accept,
    discard,
    revert,
    applyAll,
    discardAll,
    heldBack,
    isRestored: (suggestionId: string) => Boolean(restored[suggestionId]),
    restore
  };
}
