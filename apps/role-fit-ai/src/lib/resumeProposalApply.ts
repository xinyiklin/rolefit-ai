import type { ResumeBullet, ResumeData, ResumeEntry } from "@typeset/engine/lib/resumeData.ts";
import { sharedWholeFieldFormat, wholeFieldFormat, withWholeFieldFormat } from "@typeset/engine/lib/inlineMarksText.ts";

import { stripStructuralInlineMarks } from "../../shared/resumePolishContract.ts";
import { sameProposalTarget, type ResumeSourceConcern } from "../resume/proposalWarnings.ts";
import { lostAcceptedTerms, type TerminologySnapshot } from "../resume/terminology.ts";
import type { ResumeProposalSuggestion } from "../resume/types.ts";
import type { ResumeProposalDecision } from "./resumeProposalDecisionState.ts";
import { serializeResumeData } from "./resumeText.ts";

// How an accepted Resume Polish edit lands in the document. The browser applies
// it through the editor's undoable actions; the MCP server through the
// in-memory actions below, so both run the same transform.

// The editor actions an accepted edit uses; `true` marks a reviewed suggestion.
export type ResumeTargetActions = {
  addBullet(sectionId: string, entryId: string, bullet: ResumeBullet, viaSuggestion: true): void;
  removeBullet(sectionId: string, entryId: string, bulletId: string, viaSuggestion: true): void;
  reorderBullets(sectionId: string, entryId: string, from: number, to: number, viaSuggestion: true): void;
  updateBullet(sectionId: string, entryId: string, bulletId: string, value: string, viaSuggestion: true): void;
  updateEntry(sectionId: string, entryId: string, field: "subtitleLeft", value: string, viaSuggestion: true): void;
};

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
export function applyRank(suggestion: ResumeProposalSuggestion): number {
  return suggestion.kind === "reorder" ? 0 : 1;
}

// Polish sees and returns text without whole-field sizes or fonts, so an
// accepted rewrite takes its field's (a new bullet, the one its siblings share).
function withFieldFormat(entry: ResumeEntry | null, suggestion: ResumeProposalSuggestion, value: string): string {
  if (!entry || !value) return value;
  if (suggestion.target.field !== "bullet") return withWholeFieldFormat(value, wholeFieldFormat(entry.subtitleLeft ?? ""));
  const existing = entry.bullets.find((bullet) => bullet.id === suggestion.target.bulletId);
  return withWholeFieldFormat(
    value,
    existing ? wholeFieldFormat(existing.text) : sharedWholeFieldFormat(entry.bullets.map((bullet) => bullet.text))
  );
}

export function applyTarget(
  resume: ResumeData,
  actions: ResumeTargetActions,
  suggestion: ResumeProposalSuggestion,
  rawValue: string
): void {
  const { sectionId, entryId, bulletId, field } = suggestion.target;
  if (!entryId) return;
  const entry = findEntry(resume, suggestion);
  const value = suggestion.kind === "reorder" ? rawValue : withFieldFormat(entry, suggestion, rawValue);
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

// The editor reducer's bullet and entry cases, over a plain document.
function documentActions(document: { data: ResumeData }): ResumeTargetActions {
  const mapEntry = (sectionId: string, entryId: string, change: (entry: ResumeEntry) => ResumeEntry) => {
    document.data = {
      ...document.data,
      sections: document.data.sections.map((section) => section.id !== sectionId ? section : {
        ...section,
        items: section.items.map((entry) => entry.id === entryId ? change(entry) : entry)
      })
    };
  };
  return {
    addBullet: (sectionId, entryId, bullet) => mapEntry(sectionId, entryId, (entry) =>
      entry.bullets.some((item) => item.id === bullet.id) ? entry : { ...entry, bullets: [...entry.bullets, bullet] }),
    removeBullet: (sectionId, entryId, bulletId) => mapEntry(sectionId, entryId, (entry) =>
      ({ ...entry, bullets: entry.bullets.filter((item) => item.id !== bulletId) })),
    reorderBullets: (sectionId, entryId, from, to) => mapEntry(sectionId, entryId, (entry) => {
      if (from === to || from < 0 || to < 0 || from >= entry.bullets.length || to >= entry.bullets.length) return entry;
      const bullets = entry.bullets.slice();
      bullets.splice(to, 0, ...bullets.splice(from, 1));
      return { ...entry, bullets };
    }),
    updateBullet: (sectionId, entryId, bulletId, value) => mapEntry(sectionId, entryId, (entry) =>
      ({ ...entry, bullets: entry.bullets.map((item) => item.id === bulletId ? { ...item, text: value } : item) })),
    updateEntry: (sectionId, entryId, field, value) => mapEntry(sectionId, entryId, (entry) =>
      entry[field] === null ? entry : { ...entry, [field]: value })
  };
}

// Accept edits outside the editor, as Accept all does: each reads the
// pre-batch document, reorders first.
export function applyResumeSuggestions(
  resume: ResumeData,
  accepted: readonly { suggestion: ResumeProposalSuggestion; value: string }[]
): ResumeData {
  const document = { data: resume };
  const actions = documentActions(document);
  for (const { suggestion, value } of [...accepted].sort((left, right) => applyRank(left.suggestion) - applyRank(right.suggestion))) {
    applyTarget(resume, actions, suggestion, value);
  }
  return document.data;
}

// Supported job terminology that accepted edits dropped, judged on the document
// as it now stands: the advisory the review shows after acceptance.
export function acceptedTerminologyWarnings(
  result: { terminology?: TerminologySnapshot; sourceConcerns?: ResumeSourceConcern[] } | null,
  terminologyInputKey: string | undefined,
  suggestions: readonly ResumeProposalSuggestion[],
  decisions: Readonly<Record<string, ResumeProposalDecision | undefined>>,
  resume: ResumeData
): string[] {
  if (!result?.terminology || result.terminology.inputKey !== terminologyInputKey) return [];
  const accepted = suggestions.flatMap((suggestion) => {
    const decision = decisions[suggestion.id];
    const current = currentTargetText(resume, suggestion);
    return decision?.kind === "accepted" && current !== null && stripStructuralInlineMarks(current) === decision.text && suggestion.kind !== "reorder"
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
          return stripStructuralInlineMarks(currentTargetText(resume, suggestion) ?? "") === (decision?.kind === "accepted" ? decision.text : suggestion.proposedText);
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
}
