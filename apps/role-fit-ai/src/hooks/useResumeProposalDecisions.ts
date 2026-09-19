import { sameProposalTarget } from "../resume/proposalWarnings.ts";
import { lostAcceptedTerms } from "../resume/terminology.ts";
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
import { useCallback, useMemo, useState } from "react";
import type { ResumeData, ResumeEntry } from "@typeset/engine/lib/resumeData.ts";

import {
  clearProposalDecision,
  decisionsForProposal,
  recordProposalDecision,
  resumeProposalEditState,
  resumeProposalEditIsPending,
  resumeProposalKey,
  type ResumeProposalDecisionState
} from "../lib/resumeProposalDecisionState.ts";
import type { PolishedResume, ResumeProposalSuggestion } from "../resumeEngine.ts";
import type { ResumeEditorActions } from "./useResumeEditor.ts";

export type { ResumeProposalDecision } from "../lib/resumeProposalDecisionState.ts";

function findEntry(resume: ResumeData, suggestion: ResumeProposalSuggestion): ResumeEntry | null {
  const section = resume.sections.find((item) => item.id === suggestion.target.sectionId);
  return section?.items.find((entry) => entry.id === suggestion.target.entryId) ?? null;
}

export function currentTargetText(resume: ResumeData, suggestion: ResumeProposalSuggestion): string | null {
  const entry = findEntry(resume, suggestion);
  if (!entry) return null;
  if (suggestion.target.field === "bullet") {
    return entry.bullets.find((bullet) => bullet.id === suggestion.target.bulletId)?.text ?? null;
  }
  return entry.subtitleLeft;
}

function applyTarget(actions: ResumeEditorActions, suggestion: ResumeProposalSuggestion, value: string): void {
  const { sectionId, entryId, bulletId, field } = suggestion.target;
  if (!entryId) return;
  if (field === "bullet") {
    if (bulletId) actions.updateBullet(sectionId, entryId, bulletId, value, true);
    return;
  }
  actions.updateEntry(sectionId, entryId, "subtitleLeft", value, true);
}

type UseResumeProposalDecisionsArgs = {
  result: PolishedResume | null;
  resume: ResumeData;
  actions: ResumeEditorActions;
  terminologyInputKey?: string;
};

export function useResumeProposalDecisions({
  result,
  resume,
  actions,
  terminologyInputKey
}: UseResumeProposalDecisionsArgs) {
  const documentReplaced = result?.documentGeneration !== undefined && result.documentGeneration !== actions.getDocumentGeneration();
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
    (suggestion: ResumeProposalSuggestion): boolean => {
      const current = currentTargetText(resume, suggestion);
      return !documentReplaced && resumeProposalEditIsPending(current, suggestion, decisions[suggestion.id]);
    },
    [decisions, resume, documentReplaced]
  );

  const outstanding = useMemo(
    () => suggestions.filter(isPending).length,
    [isPending, suggestions]
  );

  const accept = useCallback(
    (suggestion: ResumeProposalSuggestion, value = suggestion.proposedText) => {
      if (!value.trim() || !isPending(suggestion)) return;
      applyTarget(actions, suggestion, value);
      setDecisionState((current) => recordProposalDecision(
        current,
        proposalKey,
        suggestion.id,
        { kind: "accepted", text: value }
      ));
    },
    [actions, proposalKey, isPending]
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
    if (documentReplaced) return;
    const decision = decisions[suggestion.id];
    const state = resumeProposalEditState(currentTargetText(resume, suggestion), suggestion, decision);
    if (state !== "accepted" && state !== "discarded") return;
    if (decision?.kind === "accepted") {
      applyTarget(actions, suggestion, suggestion.currentText);
    }
    setDecisionState((current) => clearProposalDecision(current, proposalKey, suggestion.id));
  }, [actions, decisions, proposalKey, resume, documentReplaced]);

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

  // The counterpart to Accept all, and the reason the resume's bulk pair now
  // reads like the letter's: both documents can decline a whole proposal in one
  // move. It mutates nothing — every discarded row still offers Undo.
  const discardAll = useCallback(() => {
    const pending = suggestions.filter(isPending);
    setDecisionState((current) => pending.reduce(
      (next, suggestion) => recordProposalDecision(next, proposalKey, suggestion.id, { kind: "discarded" }),
      current
    ));
  }, [isPending, proposalKey, suggestions]);

  const accepted = suggestions.flatMap((suggestion) => {
    const decision = decisions[suggestion.id];
    const current = currentTargetText(resume, suggestion);
    return decision?.kind === "accepted" && current === decision.text
      ? [{ original: suggestion.currentText, current }] : [];
  });
  const uncertainEdits: Array<{ original: string; current: string }> = [];
  const evidenceResume = { ...resume, sections: resume.sections.map((section) => ({ ...section,
    items: section.items.map((entry) => {
      const uncertain = suggestions.filter((suggestion) => suggestion.warnings?.length
        && suggestion.target.sectionId === section.id && suggestion.target.entryId === entry.id
        && (() => {
          const decision = decisions[suggestion.id];
          return currentTargetText(resume, suggestion) === (decision?.kind === "accepted" ? decision.text : suggestion.proposedText);
        })());
      for (const suggestion of uncertain) {
        const prior = result?.sourceConcerns?.find((concern) => sameProposalTarget(concern.target, suggestion.target));
        uncertainEdits.push({
          original: prior?.originalText ?? suggestion.currentText,
          current: currentTargetText(resume, suggestion) ?? ""
        });
      }
      return { ...entry,
        subtitleLeft: uncertain.some((suggestion) => suggestion.target.field === "skill") ? "" : entry.subtitleLeft,
        bullets: entry.bullets.map((bullet) => uncertain.some((suggestion) => suggestion.target.bulletId === bullet.id)
          ? { ...bullet, text: "" } : bullet)
      };
    })
  })) };
  const currentEvidence = serializeResumeData(evidenceResume);
  const terminologyWarnings = lostAcceptedTerms(result?.terminology, terminologyInputKey, currentEvidence, accepted, uncertainEdits);

  return {
    documentReplaced,
    terminologyWarnings,
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
    discardAll
  };
}
