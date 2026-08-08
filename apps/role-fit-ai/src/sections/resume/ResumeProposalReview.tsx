import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import type { ResumeData, ResumeEntry } from "@typeset/engine/lib/resumeData.ts";

import type { ResumeEditorActions } from "../../hooks/useResumeEditor";
import { renderInlineMarks, stripInlineMarks } from "../../lib/inlineMarks";
import type { PolishedResume, TailorSuggestion } from "../../resumeEngine";
import type { TailorChangeTarget } from "../../resume/types";
import { ProposalFeedbackList } from "../document/ProposalFeedbackList";

type ResumeProposalReviewProps = {
  result: PolishedResume;
  resume: ResumeData;
  actions: ResumeEditorActions;
  onHighlight: (target: TailorChangeTarget | null) => void;
};

type Decision = { kind: "accepted"; text: string } | { kind: "discarded" };

const normalize = (value: string) => stripInlineMarks(value).replace(/\s+/g, " ").trim().toLowerCase();

function findEntry(resume: ResumeData, suggestion: TailorSuggestion): ResumeEntry | null {
  const section = resume.sections.find((item) => item.id === suggestion.target.sectionId);
  return section?.items.find((entry) => entry.id === suggestion.target.entryId) ?? null;
}

function currentTargetText(resume: ResumeData, suggestion: TailorSuggestion): string | null {
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

export function ResumeProposalReview({
  result,
  resume,
  actions,
  onHighlight
}: ResumeProposalReviewProps) {
  const suggestions = result.suggestedChanges ?? [];
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const isPending = (suggestion: TailorSuggestion): boolean => {
    if (decisions[suggestion.id]?.kind === "discarded") return false;
    const current = currentTargetText(resume, suggestion);
    return current !== null && normalize(current) === normalize(suggestion.currentText);
  };
  const pendingCount = suggestions.filter(isPending).length;

  function accept(suggestion: TailorSuggestion, value = suggestion.proposedText): void {
    if (!value.trim()) return;
    applyTarget(actions, suggestion, value);
    setDecisions((current) => ({ ...current, [suggestion.id]: { kind: "accepted", text: value } }));
    setEditingId(null);
    setDraft("");
  }

  function discard(suggestion: TailorSuggestion): void {
    setDecisions((current) => ({ ...current, [suggestion.id]: { kind: "discarded" } }));
  }

  function applyAll(): void {
    const pending = suggestions.filter(isPending);
    for (const suggestion of pending) {
      applyTarget(actions, suggestion, suggestion.proposedText);
    }
    setDecisions((current) => ({
      ...current,
      ...Object.fromEntries(pending.map((suggestion) => [
        suggestion.id,
        { kind: "accepted", text: suggestion.proposedText } satisfies Decision
      ]))
    }));
  }

  if (result.polishOutcome === "NO_CHANGES") {
    return <p className="resume-proposal__empty">No safe material changes were suggested.</p>;
  }
  if (result.polishOutcome === "WITHHELD" && !suggestions.length) {
    return <p className="resume-proposal__empty is-warn">The generated edits could not be verified. Your resume is unchanged.</p>;
  }

  return (
    <div className="resume-proposal">
      <ProposalFeedbackList title="What improved" items={result.changeSummary?.slice(0, 3) ?? []} />

      {suggestions.length ? (
        <section className="resume-proposal__section">
          <div className="resume-proposal__head">
            <div>
              <h3>Edits ready</h3>
              <p>{pendingCount} of {suggestions.length} waiting for your decision</p>
            </div>
            <button className="primary-button is-compact" type="button" onClick={applyAll} disabled={!pendingCount}>
              Apply all
            </button>
          </div>
          <details className="resume-proposal__edits">
            <summary>Review individual edits</summary>
            <div className="resume-proposal__edit-list">
              {suggestions.map((suggestion) => {
                const decision = decisions[suggestion.id];
                const current = currentTargetText(resume, suggestion);
                const pending = isPending(suggestion);
                const editing = editingId === suggestion.id;
                const accepted = decision?.kind === "accepted" || (
                  current !== null && normalize(current) === normalize(suggestion.proposedText)
                );
                return (
                  <article
                    className="resume-proposal__edit"
                    key={suggestion.id}
                    onMouseEnter={() => onHighlight(suggestion.target)}
                    onMouseLeave={() => onHighlight(null)}
                    onFocus={() => onHighlight(suggestion.target)}
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) onHighlight(null);
                    }}
                  >
                    <p className="resume-proposal__label">Original</p>
                    <p className="resume-proposal__original">{renderInlineMarks(suggestion.currentText)}</p>
                    <p className="resume-proposal__label">Proposed</p>
                    {editing ? (
                      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} />
                    ) : (
                      <p className="resume-proposal__replacement">
                        {renderInlineMarks(decision?.kind === "accepted" ? decision.text : suggestion.proposedText)}
                      </p>
                    )}
                    {suggestion.reason && !editing ? <p className="resume-proposal__reason">{suggestion.reason}</p> : null}
                    <div className="resume-proposal__actions">
                      {editing ? (
                        <>
                          <button className="primary-button is-compact" type="button" onClick={() => accept(suggestion, draft)} disabled={!draft.trim()}>
                            <Check size={13} aria-hidden="true" /> Apply edit
                          </button>
                          <button className="ghost-button is-compact" type="button" onClick={() => setEditingId(null)}>Cancel</button>
                        </>
                      ) : pending ? (
                        <>
                          <button className="primary-button is-compact" type="button" onClick={() => accept(suggestion)}>
                            <Check size={13} aria-hidden="true" /> Accept
                          </button>
                          <button className="ghost-button is-compact" type="button" onClick={() => {
                            setEditingId(suggestion.id);
                            setDraft(suggestion.proposedText);
                          }}>
                            <Pencil size={13} aria-hidden="true" /> Edit
                          </button>
                          <button className="ghost-button is-compact" type="button" onClick={() => discard(suggestion)}>
                            <X size={13} aria-hidden="true" /> Discard
                          </button>
                        </>
                      ) : (
                        <span className="resume-proposal__decision">
                          {accepted ? "Applied" : decision?.kind === "discarded" ? "Discarded" : "Resume changed"}
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </details>
        </section>
      ) : null}

      <ProposalFeedbackList title="Still missing" items={result.remainingGaps?.slice(0, 3) ?? []} tone="warning" />

      {result.withheld?.count ? (
        <p className="resume-proposal__withheld">
          {result.withheld.count} generated edit{result.withheld.count === 1 ? " was" : "s were"} withheld because it could not be verified.
        </p>
      ) : null}
    </div>
  );
}
