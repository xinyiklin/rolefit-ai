/**
 * useResumeProposalDecisions — accept / edit / discard state for the resume
 * proposal's individual edits.
 *
 * It used to live inside `ResumeProposalReview`, which was fine while nothing
 * outside that component cared when the user finished. The unified workflow
 * does care: the resulting resume only exists once every edit has a decision,
 * and that is exactly when the current-document check may run. Ownership moved
 * up so the workflow can observe "no decisions outstanding" instead of the
 * review component having to reach out and trigger it.
 *
 * A decision is never the source of truth about the document. `outstanding`
 * re-derives from the LIVE resume every render, so a manual edit that happens
 * to match a proposed replacement counts as decided, and an undo that restores
 * the original text makes the edit pending again.
 */
import { useCallback, useMemo, useState } from "react";
import type { ResumeData, ResumeEntry } from "@typeset/engine/lib/resumeData.ts";

import {
  decisionsForProposal,
  recordProposalDecision,
  resumeProposalEditIsPending,
  resumeProposalKey,
  type ResumeProposalDecisionState
} from "../lib/resumeProposalDecisionState.ts";
import type { PolishedResume, TailorSuggestion } from "../resumeEngine.ts";
import type { ResumeEditorActions } from "./useResumeEditor.ts";

export type { ResumeProposalDecision } from "../lib/resumeProposalDecisionState.ts";

function findEntry(resume: ResumeData, suggestion: TailorSuggestion): ResumeEntry | null {
  const section = resume.sections.find((item) => item.id === suggestion.target.sectionId);
  return section?.items.find((entry) => entry.id === suggestion.target.entryId) ?? null;
}

export function currentTargetText(resume: ResumeData, suggestion: TailorSuggestion): string | null {
  const entry = findEntry(resume, suggestion);
  if (!entry) return null;
  if (suggestion.target.field === "bullet") {
    return entry.bullets.find((bullet) => bullet.id === suggestion.target.bulletId)?.text ?? null;
  }
  if (suggestion.target.field === "skill") return entry.subtitleLeft;
  return entry[suggestion.target.field] ?? null;
}

function applyTarget(actions: ResumeEditorActions, suggestion: TailorSuggestion, value: string): void {
  const { sectionId, entryId, bulletId, field } = suggestion.target;
  if (!entryId) return;
  if (field === "bullet") {
    if (bulletId) actions.updateBullet(sectionId, entryId, bulletId, value, true);
    return;
  }
  actions.updateEntry(sectionId, entryId, field === "skill" ? "subtitleLeft" : field, value, true);
}

type UseResumeProposalDecisionsArgs = {
  result: PolishedResume | null;
  resume: ResumeData;
  actions: ResumeEditorActions;
};

export function useResumeProposalDecisions({
  result,
  resume,
  actions
}: UseResumeProposalDecisionsArgs) {
  const suggestions = useMemo(() => result?.suggestedChanges ?? [], [result]);
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

  const isPending = useCallback(
    (suggestion: TailorSuggestion): boolean => {
      const current = currentTargetText(resume, suggestion);
      return resumeProposalEditIsPending(current, suggestion, decisions[suggestion.id]);
    },
    [decisions, resume]
  );

  const outstanding = useMemo(
    () => suggestions.filter(isPending).length,
    [isPending, suggestions]
  );

  const accept = useCallback(
    (suggestion: TailorSuggestion, value = suggestion.proposedText) => {
      if (!value.trim()) return;
      applyTarget(actions, suggestion, value);
      setDecisionState((current) => recordProposalDecision(
        current,
        proposalKey,
        suggestion.id,
        { kind: "accepted", text: value }
      ));
    },
    [actions, proposalKey]
  );

  const discard = useCallback((suggestion: TailorSuggestion) => {
    setDecisionState((current) => recordProposalDecision(
      current,
      proposalKey,
      suggestion.id,
      { kind: "discarded" }
    ));
  }, [proposalKey]);

  const applyAll = useCallback(() => {
    const pending = suggestions.filter(isPending);
    for (const suggestion of pending) applyTarget(actions, suggestion, suggestion.proposedText);
    setDecisionState((current) => pending.reduce(
      (next, suggestion) => recordProposalDecision(
        next,
        proposalKey,
        suggestion.id,
        { kind: "accepted", text: suggestion.proposedText }
      ),
      current
    ));
  }, [actions, isPending, proposalKey, suggestions]);

  return {
    decisions,
    proposalKey,
    suggestions,
    outstanding,
    total: suggestions.length,
    // A proposal with no edits to decide (No changes / fully withheld) is
    // settled the moment it arrives; there is nothing for the user to resolve.
    decisionsSettled: Boolean(result?.polishOutcome) && outstanding === 0,
    isPending,
    accept,
    discard,
    applyAll
  };
}
