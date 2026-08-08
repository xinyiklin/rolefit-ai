import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";

import type { useResumeProposalDecisions } from "../../hooks/useResumeProposalDecisions";
import { currentTargetText } from "../../hooks/useResumeProposalDecisions";
import { renderInlineMarks, stripInlineMarks } from "../../lib/inlineMarks";
import type { PolishedResume } from "../../resumeEngine";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import type { TailorChangeTarget } from "../../resume/types";
import { ProposalFeedbackList } from "../document/ProposalFeedbackList";

type ResumeProposalReviewProps = {
  result: PolishedResume;
  resume: ResumeData;
  // Decision state is owned by the workflow, not by this component: the
  // current-resume check runs when the last decision settles, and the review
  // list cannot be the thing that knows.
  decisions: ReturnType<typeof useResumeProposalDecisions>;
  onHighlight: (target: TailorChangeTarget | null) => void;
};

const normalize = (value: string) => stripInlineMarks(value).replace(/\s+/g, " ").trim().toLowerCase();

export function ResumeProposalReview({
  result,
  resume,
  decisions: proposal,
  onHighlight
}: ResumeProposalReviewProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const { suggestions, decisions, outstanding, isPending, accept, discard, applyAll } = proposal;

  function acceptEdit(suggestionId: string, value: string): void {
    const suggestion = suggestions.find((entry) => entry.id === suggestionId);
    if (!suggestion) return;
    accept(suggestion, value);
    setEditingId(null);
    setDraft("");
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
              <p>{outstanding} of {suggestions.length} waiting for your decision</p>
            </div>
            <button className="primary-button is-compact" type="button" onClick={applyAll} disabled={!outstanding}>
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
                          <button className="primary-button is-compact" type="button" onClick={() => acceptEdit(suggestion.id, draft)} disabled={!draft.trim()}>
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
