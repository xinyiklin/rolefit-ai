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
  proposalBaseline,
  proposalValue,
  recordProposalDecision,
  recordProposalRestore,
  restoredForProposal,
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

// A new bullet that is not in the entry reads as its empty original, so an
// unaccepted or removed addition is pending again; a missing bullet reads as
// an accepted removal. A reorder reads the live order of its original bullets.
export function currentTargetText(resume: ResumeData, suggestion: ResumeProposalSuggestion): string | null {
  const entry = findEntry(resume, suggestion);
  if (!entry) return null;
  if (suggestion.kind === "reorder") {
    const original = suggestion.originalOrder ?? [];
    return entry.bullets.map((bullet) => bullet.id).filter((id) => original.includes(id)).join("\n");
  }
  if (suggestion.target.field === "bullet") {
    const text = entry.bullets.find((bullet) => bullet.id === suggestion.target.bulletId)?.text;
    return text ?? (suggestion.kind === "add" || suggestion.kind === "remove" ? "" : null);
  }
  return entry.subtitleLeft;
}

// Moves the listed bullets into `order` within the slots they occupy, leaving
// any other bullet (an accepted addition) where it is.
function reorderEntryBullets(entry: ResumeEntry, order: string[], move: (from: number, to: number) => void): void {
  const ids = entry.bullets.map((bullet) => bullet.id);
  const present = order.filter((id) => ids.includes(id));
  let next = 0;
  const desired = ids.map((id) => present.includes(id) ? present[next++] : id);
  for (let index = 0; index < desired.length; index += 1) {
    const from = ids.indexOf(desired[index]);
    if (from === index) continue;
    move(from, index);
    ids.splice(index, 0, ...ids.splice(from, 1));
  }
}

// Every step of a bulk decision reads the pre-batch document. Reorders move by
// index, so they run first; every other change addresses its bullet by id.
function applyRank(suggestion: ResumeProposalSuggestion): number {
  return suggestion.kind === "reorder" ? 0 : 1;
}

function applyTarget(
  resume: ResumeData,
  actions: ResumeEditorActions,
  suggestion: ResumeProposalSuggestion,
  value: string
): void {
  const { sectionId, entryId, bulletId, field } = suggestion.target;
  if (!entryId) return;
  const entry = findEntry(resume, suggestion);
  if (suggestion.kind === "reorder") {
    if (entry) reorderEntryBullets(entry, value.split("\n"), (from, to) => actions.reorderBullets(sectionId, entryId, from, to, true));
    return;
  }
  if (suggestion.kind === "remove") {
    if (!bulletId || !entry) return;
    const exists = entry.bullets.some((bullet) => bullet.id === bulletId);
    if (!value) {
      if (exists) actions.removeBullet(sectionId, entryId, bulletId, true);
      return;
    }
    if (exists) return;
    // Restore after the nearest original predecessor still in the entry.
    const original = suggestion.originalOrder ?? [];
    const before = original.slice(0, original.indexOf(bulletId)).reverse()
      .map((id) => entry.bullets.findIndex((bullet) => bullet.id === id))
      .find((index) => index >= 0);
    actions.addBullet(sectionId, entryId, { id: bulletId, text: value }, true);
    const to = before === undefined ? 0 : before + 1;
    if (to !== entry.bullets.length) actions.reorderBullets(sectionId, entryId, entry.bullets.length, to, true);
    return;
  }
  if (field === "bullet") {
    if (!bulletId) return;
    const exists = findEntry(resume, suggestion)?.bullets.some((bullet) => bullet.id === bulletId);
    if (suggestion.kind === "add" && !exists) actions.addBullet(sectionId, entryId, { id: bulletId, text: value }, true);
    else if (suggestion.kind === "add" && !value) actions.removeBullet(sectionId, entryId, bulletId, true);
    else actions.updateBullet(sectionId, entryId, bulletId, value, true);
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

  const terminologyWarnings = useMemo(() => {
    if (!result?.terminology || result.terminology.inputKey !== terminologyInputKey) return [];
    const accepted = suggestions.flatMap((suggestion) => {
      const decision = decisions[suggestion.id];
      const current = currentTargetText(resume, suggestion);
      return decision?.kind === "accepted" && current === decision.text && suggestion.kind !== "reorder"
        ? [{ original: suggestion.currentText, current }] : [];
    });
    if (!accepted.length) return [];
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
    return lostAcceptedTerms(result.terminology, terminologyInputKey, currentEvidence, accepted, uncertainEdits);
  }, [decisions, resume, result, suggestions, terminologyInputKey]);

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
    discardAll,
    heldBack,
    isRestored: (suggestionId: string) => Boolean(restored[suggestionId]),
    restore
  };
}
