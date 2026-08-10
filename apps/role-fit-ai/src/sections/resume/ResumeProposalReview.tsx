import { useState } from "react";
import { Check, Pencil, Undo2, X } from "lucide-react";

import type { useResumeProposalDecisions } from "../../hooks/useResumeProposalDecisions";
import { currentTargetText } from "../../hooks/useResumeProposalDecisions";
import { stripInlineMarks } from "../../lib/inlineMarks";
import { resumeProposalEditState } from "../../lib/resumeProposalDecisionState.ts";
import type { PolishedResume, ResumeProposalSuggestion } from "../../resumeEngine";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import type { ResumeProposalTarget } from "../../resume/types";
import { ProposalDiff } from "../document/ProposalDiff";
import { ProposalFeedbackList } from "../document/ProposalFeedbackList";

type ResumeProposalReviewProps = {
  result: PolishedResume;
  resume: ResumeData;
  // Decision state is owned by the workflow, not by this component: the
  // current-resume check runs when the last decision settles, and the review
  // list cannot be the thing that knows.
  decisions: ReturnType<typeof useResumeProposalDecisions>;
  proposalStale: boolean;
  onHighlight: (target: ResumeProposalTarget | null) => void;
};

// Which part of the resume an edit touches. Hovering a row highlights it in the
// document, but a row also has to say where it lives for a user reading the
// list with the rail collapsed over the page or on a stacked viewport.
function editLocation(resume: ResumeData, suggestion: ResumeProposalSuggestion): string {
  const section = resume.sections.find((item) => item.id === suggestion.target.sectionId);
  const entry = section?.items.find((item) => item.id === suggestion.target.entryId);
  const heading = stripInlineMarks(suggestion.sectionHeading || section?.heading || "Resume").trim();
  const title = stripInlineMarks(entry?.titleLeft ?? "").trim();
  return title ? `${heading} · ${title}` : heading;
}

export function ResumeProposalReview({
  result,
  resume,
  decisions: proposal,
  proposalStale,
  onHighlight
}: ResumeProposalReviewProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const { suggestions, decisions, decided, isPending, accept, discard, revert } = proposal;
  const omittedNote = result.omittedTargetCount ? (
    <p className="resume-proposal__omitted">
      {result.omittedTargetCount} other editable field{result.omittedTargetCount === 1 ? " was" : "s were"} outside this Polish pass.
    </p>
  ) : null;

  function acceptEdit(suggestionId: string, value: string): void {
    if (proposalStale) return;
    const suggestion = suggestions.find((entry) => entry.id === suggestionId);
    if (!suggestion) return;
    accept(suggestion, value);
    setEditingId(null);
    setDraft("");
  }

  if (result.polishOutcome === "NO_CHANGES") {
    return <><p className="resume-proposal__empty">No safe material changes were suggested.</p>{omittedNote}</>;
  }
  if (result.polishOutcome === "WITHHELD" && !suggestions.length) {
    return <><p className="resume-proposal__empty is-warn">The generated edits could not be verified. Your resume is unchanged.</p>{omittedNote}</>;
  }

  return (
    <div className="resume-proposal">
      <ProposalFeedbackList title="What improved" items={result.changeSummary?.slice(0, 3) ?? []} />

      {suggestions.length ? (
        // Open by default: the edits ARE the review, and the letter shows its
        // whole proposed replacement without asking first. The disclosure stays
        // so a long list can be folded away while the footer keeps the decision.
        <details className="resume-proposal__edits" open>
          <summary>
            {suggestions.length} proposed edit{suggestions.length === 1 ? "" : "s"}
          </summary>
          <div className="resume-proposal__edit-list">
            {suggestions.map((suggestion) => {
              const decision = decisions[suggestion.id];
              const current = currentTargetText(resume, suggestion);
              const pending = isPending(suggestion);
              const editing = editingId === suggestion.id;
              const state = resumeProposalEditState(current, suggestion, decision);
              const proposedText = decision?.kind === "accepted" ? decision.text : suggestion.proposedText;
              return (
                <article
                  className="resume-proposal__edit"
                  data-state={state}
                  key={suggestion.id}
                  onMouseEnter={() => onHighlight(suggestion.target)}
                  onMouseLeave={() => onHighlight(null)}
                  onFocus={() => onHighlight(suggestion.target)}
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) onHighlight(null);
                  }}
                >
                  <header className="resume-proposal__edit-head">
                    <p className="resume-proposal__where">{editLocation(resume, suggestion)}</p>
                    {state === "pending" ? null : (
                      <span className="proposal-chip" data-state={state}>
                        {state === "accepted" ? "Accepted" : state === "discarded" ? "Discarded" : "Changed in editor"}
                      </span>
                    )}
                  </header>
                  <p className="resume-proposal__label">Now</p>
                  <p className="resume-proposal__original">
                    <ProposalDiff original={suggestion.currentText} proposed={proposedText} mode="removed" />
                  </p>
                  <p className="resume-proposal__label">Proposed</p>
                  {editing ? (
                    <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} />
                  ) : (
                    <p className="resume-proposal__replacement">
                      <ProposalDiff original={suggestion.currentText} proposed={proposedText} mode="added" />
                    </p>
                  )}
                  {suggestion.reason && !editing ? <p className="resume-proposal__reason">{suggestion.reason}</p> : null}
                  <div className="resume-proposal__actions">
                    {editing ? (
                      <>
                        <button className="primary-button is-compact" type="button" onClick={() => acceptEdit(suggestion.id, draft)} disabled={proposalStale || !draft.trim()}>
                          <Check size={13} aria-hidden="true" /> Accept edited
                        </button>
                        <button className="ghost-button is-compact" type="button" onClick={() => setEditingId(null)}>Cancel</button>
                      </>
                    ) : pending ? (
                      <>
                        <button className="primary-button is-compact" type="button" onClick={() => accept(suggestion)} disabled={proposalStale}>
                          <Check size={13} aria-hidden="true" /> Accept
                        </button>
                        <button className="ghost-button is-compact" type="button" disabled={proposalStale} onClick={() => {
                          setEditingId(suggestion.id);
                          setDraft(suggestion.proposedText);
                        }}>
                          <Pencil size={13} aria-hidden="true" /> Edit
                        </button>
                        <button className="ghost-button is-compact" type="button" onClick={() => discard(suggestion)}>
                          <X size={13} aria-hidden="true" /> Discard
                        </button>
                      </>
                    ) : state === "changed" ? (
                      // The document moved on its own — there is no recorded
                      // decision to take back, so Undo would have nothing to do.
                      <span className="resume-proposal__decision">Edited in the document since this proposal</span>
                    ) : (
                      <button className="ghost-button is-compact" type="button" onClick={() => revert(suggestion)}>
                        <Undo2 size={13} aria-hidden="true" /> Undo
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {decided > 0 ? (
            <p className="resume-proposal__decided-note">
              {decided} of {suggestions.length} decided. Undo returns an edit to this queue.
            </p>
          ) : null}
        </details>
      ) : null}


      {result.withheld?.count ? (
        <p className="resume-proposal__withheld">
          {result.withheld.count} generated edit{result.withheld.count === 1 ? " was" : "s were"} withheld because it could not be verified.
        </p>
      ) : null}
      {omittedNote}
    </div>
  );
}
