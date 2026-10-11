import { ContentWarnings } from "../../components/ContentWarnings.tsx";
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
import { FitGapStatements } from "../document/FitGapStatements";
import { ResumeHeldBackEdits } from "./ResumeHeldBackEdits";
import { TerminologyCoverageView } from "./TerminologyCoverageView";

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
  const where = title ? `${heading} · ${title}` : heading;
  return suggestion.kind === "add" ? `${where} · New bullet` : where;
}

// Rows group by what accepting them does to the document.
const PROPOSAL_GROUPS = [
  { kind: undefined, label: "Rewrite" },
  { kind: "add", label: "Add" },
  { kind: "remove", label: "Remove" },
  { kind: "reorder", label: "Reorder" }
] as const;

// A reorder has no single field; it points at the bullet it moves to the top.
function highlightTarget(suggestion: ResumeProposalSuggestion): ResumeProposalTarget {
  return suggestion.kind === "reorder"
    ? { ...suggestion.target, bulletId: suggestion.proposedOrder?.[0] }
    : suggestion.target;
}

// What an edit can rest on, folded away: the entry as it stands now and every
// Profile block linked to it when the proposal was made. Reading a source is
// not verification, so the row's warnings stay where they are.
function EditEvidence({ resume, suggestion }: { resume: ResumeData; suggestion: ResumeProposalSuggestion }) {
  const section = resume.sections.find((item) => item.id === suggestion.target.sectionId);
  if (!section) return null;
  if (section.type !== "standard") {
    return <p className="resume-proposal__reason">Evidence: the resume sections in scope and the whole Profile.</p>;
  }
  const entry = section.items.find((item) => item.id === suggestion.target.entryId);
  const title = [entry?.titleLeft, entry?.subtitleLeft].map((text) => stripInlineMarks(text ?? "").trim()).filter(Boolean).join(" · ");
  return (
    <details className="resume-proposal__evidence">
      <summary>Show evidence</summary>
      <div className="resume-proposal__evidence-body">
        <p className="resume-proposal__label">Resume now{title ? ` · ${title}` : ""}</p>
        {entry?.bullets.length ? (
          <ul>{entry.bullets.map((bullet) => <li key={bullet.id}>{stripInlineMarks(bullet.text)}</li>)}</ul>
        ) : <p className="resume-proposal__evidence-text">No bullets.</p>}
        <p className="resume-proposal__label">Profile</p>
        <p className="resume-proposal__evidence-text">{suggestion.profileEvidence ?? "No Profile heading links to this entry."}</p>
      </div>
    </details>
  );
}

function ProposedOrder({ resume, suggestion }: { resume: ResumeData; suggestion: ResumeProposalSuggestion }) {
  const bullets = resume.sections.find((section) => section.id === suggestion.target.sectionId)
    ?.items.find((entry) => entry.id === suggestion.target.entryId)?.bullets ?? [];
  const original = suggestion.originalOrder ?? [];
  return (
    <ol className="resume-proposal__order">
      {(suggestion.proposedOrder ?? []).map((id, index) => {
        const bullet = bullets.find((item) => item.id === id);
        if (!bullet) return null;
        const was = original.indexOf(id);
        return (
          <li key={id}>
            <span>{stripInlineMarks(bullet.text)}</span>
            {was !== index ? <span className="resume-proposal__moved">was {was + 1}</span> : null}
          </li>
        );
      })}
    </ol>
  );
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
  const { suggestions, decisions, decided, isPending, accept, discard, revert, applyAll, discardAll, heldBack, isRestored, restore } = proposal;
  const groups = PROPOSAL_GROUPS
    .map((group) => ({ ...group, items: suggestions.filter((suggestion) => suggestion.kind === group.kind) }))
    .filter((group) => group.items.length);
  const omittedNote = result.omittedTargetCount ? (
    <p className="resume-proposal__omitted">
      {result.omittedTargetCount} other editable field{result.omittedTargetCount === 1 ? " was" : "s were"} outside this Polish pass.
    </p>
  ) : null;

  const advice = result.advice?.length ? (
    <details className="prepare-note">
      <summary>Suggestions{proposalStale || result.adviceStale ? " · Previous inputs" : ""}</summary>
      <ul>{result.advice.map((item, index) => {
        const section = resume.sections.find((section) => section.id === item.sectionId);
        const entry = section?.items.find((entry) => entry.id === item.entryId);
        const where = item.kind === "add-from-profile"
          ? "Profile · Not on this resume"
          : `${section?.heading} · ${stripInlineMarks(entry?.titleLeft ?? "")}`;
        const references = [item.jobExcerpt, item.candidateExcerpt, item.profileExcerpt].filter(Boolean);
        return <li key={index}><strong>{where}</strong><p>{item.rationale}</p><ContentWarnings warnings={item.warnings} />{item.warnings?.length ? <p>Unconfirmed references: {references.join(" / ")}</p> : <><blockquote>{item.jobExcerpt}</blockquote>{item.candidateExcerpt ? <blockquote>{item.candidateExcerpt}</blockquote> : null}{item.profileExcerpt ? <><p className="resume-proposal__label">Profile</p><blockquote>{item.profileExcerpt}</blockquote></> : null}</>}</li>;
      })}</ul>
    </details>
  ) : null;

  function acceptEdit(suggestionId: string, value: string): void {
    if (proposalStale) return;
    const suggestion = suggestions.find((entry) => entry.id === suggestionId);
    if (!suggestion) return;
    accept(suggestion, value);
    setEditingId(null);
    setDraft("");
  }

  const feedback = <>
    <ContentWarnings warnings={result.warnings?.filter((warning) => warning !== "Summary feedback is not supported by provided evidence.")} />
    <ContentWarnings warnings={proposal.terminologyWarnings} />
    <ProposalFeedbackList title="Proposed improvements" items={result.changeSummary?.slice(0, 3) ?? []} />
  </>;
  const terminologyLimits = result.terminology ? <details className="prepare-note"><summary>Terminology check limits</summary><ul>{result.terminology.limitations.map((note) => <li key={note}>{note}</li>)}</ul></details> : null;
  const fitGaps = (
    <FitGapStatements
      earlierVersion={Boolean(result.fitFindings?.earlierVersion)}
      rows={proposal.fitGapRows.map((row) => ({ ...row, where: row.suggestions.map((suggestion) => editLocation(resume, suggestion)) }))}
    />
  );
  const termCoverage = <TerminologyCoverageView coverage={proposal.termCoverage} />;
  const heldBackTotal = result.heldBack?.length ?? 0;
  const reviewNote = result.review === "UNAVAILABLE"
    ? <p className="resume-proposal__omitted">Review unavailable; showing all edits.</p>
    : result.review === "REVIEWED" && !heldBackTotal
      ? <p className="resume-proposal__omitted">Review kept all {suggestions.length} edit{suggestions.length === 1 ? "" : "s"}.</p>
      : null;
  const heldBackEdits = (
    <ResumeHeldBackEdits
      total={heldBackTotal}
      items={heldBack}
      disabled={proposalStale || proposal.documentReplaced}
      locationOf={(suggestion) => editLocation(resume, suggestion)}
      onRestore={restore}
    />
  );
  // A review that held back every edit keeps the proposal root below, so a Restore
  // never remounts the held-back list (dropping focus) and the withheld line stays.
  if (result.polishOutcome === "NO_CHANGES" && !suggestions.length && !heldBackTotal) {
    return <><p className="resume-proposal__empty" role="status">No material changes were suggested.</p>{feedback}{fitGaps}{advice}{omittedNote}{termCoverage}{terminologyLimits}</>;
  }
  if (result.polishOutcome === "WITHHELD" && !suggestions.length) {
    return <><p className="resume-proposal__empty is-warn" role="status">No usable edits were returned. Your resume is unchanged.</p>{feedback}{fitGaps}{advice}{omittedNote}{termCoverage}{terminologyLimits}</>;
  }

  return (
    <div className="resume-proposal">
      {result.polishOutcome === "NO_CHANGES" && !suggestions.length ? <p className="resume-proposal__empty" role="status">No worthwhile changes after review.</p> : null}
      {feedback}

      {suggestions.length ? (
        // Open by default: the edits ARE the review, and the letter shows its
        // whole proposed replacement without asking first. The disclosure stays
        // so a long list can be folded away while the footer keeps the decision.
        <details className="resume-proposal__edits" open>
          <summary>
            {suggestions.length} proposed edit{suggestions.length === 1 ? "" : "s"}
          </summary>
          {groups.map((group) => {
            // A row open for editing stays out of group actions so its draft survives.
            const bulkItems = group.items.filter((item) => item.id !== editingId);
            const pendingCount = bulkItems.filter(isPending).length;
            const headingId = `resume-proposal-group-${group.label.toLowerCase()}`;
            return (
              <section className="resume-proposal__group" key={group.label} aria-labelledby={headingId}>
                <header className="resume-proposal__group-head">
                  <h3 id={headingId}>{group.label} <span>{group.items.length}</span></h3>
                  {groups.length > 1 && pendingCount ? (
                    <span className="resume-proposal__group-actions">
                      <button className="ghost-button is-compact" type="button" disabled={proposalStale} onClick={() => applyAll(bulkItems)}>
                        <Check size={13} aria-hidden="true" /> Accept {pendingCount}
                        <span className="sr-only"> {group.label.toLowerCase()}</span>
                      </button>
                      <button className="ghost-button is-compact" type="button" onClick={() => discardAll(bulkItems)}>
                        <X size={13} aria-hidden="true" /> Discard
                        <span className="sr-only"> {group.label.toLowerCase()}</span>
                      </button>
                    </span>
                  ) : null}
                </header>
                <div className="resume-proposal__edit-list">
                  {group.items.map((suggestion) => {
                    const decision = decisions[suggestion.id];
                    const current = currentTargetText(resume, suggestion);
                    const pending = isPending(suggestion);
                    const editing = editingId === suggestion.id && pending;
                    const state = resumeProposalEditState(current, suggestion, decision);
                    const proposedText = decision?.kind === "accepted" ? decision.text : suggestion.proposedText;
                    return (
                      <article
                        className="resume-proposal__edit"
                        data-state={state}
                        key={suggestion.id}
                        onMouseEnter={() => onHighlight(highlightTarget(suggestion))}
                        onMouseLeave={() => onHighlight(null)}
                        onFocus={() => onHighlight(highlightTarget(suggestion))}
                        onBlur={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget)) onHighlight(null);
                        }}
                      >
                        <header className="resume-proposal__edit-head">
                          <p className="resume-proposal__where">{editLocation(resume, suggestion)}</p>
                          <span className="resume-proposal__chips">
                            {suggestion.evidence === "profile" ? <span className="proposal-chip">Profile</span> : null}
                            {isRestored(suggestion.id) ? <span className="proposal-chip">Restored</span> : null}
                            {state === "pending" ? null : (
                              <span className="proposal-chip" data-state={state}>
                                {state === "accepted" ? "Accepted" : state === "discarded" ? "Discarded" : "Changed in editor"}
                              </span>
                            )}
                          </span>
                        </header>
                        {suggestion.kind === "reorder" ? (
                          <>
                            <p className="resume-proposal__label">Proposed order</p>
                            <ProposedOrder resume={resume} suggestion={suggestion} />
                          </>
                        ) : suggestion.kind === "remove" ? (
                          <p className="resume-proposal__original is-removed">
                            <ProposalDiff original={suggestion.currentText} proposed="" mode="removed" />
                          </p>
                        ) : (
                          <>
                            {suggestion.kind === "add" ? null : (
                              <>
                                <p className="resume-proposal__label">Now</p>
                                <p className="resume-proposal__original">
                                  <ProposalDiff original={suggestion.currentText} proposed={proposedText} mode="removed" />
                                </p>
                              </>
                            )}
                            <p className="resume-proposal__label">Proposed</p>
                            {editing ? (
                              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} />
                            ) : (
                              <p className="resume-proposal__replacement">
                                <ProposalDiff original={suggestion.currentText} proposed={proposedText} mode="added" />
                              </p>
                            )}
                          </>
                        )}
                        {suggestion.reason && !editing ? <p className="resume-proposal__reason">{suggestion.reason}</p> : null}
                        {suggestion.profileSource ? <p className="resume-proposal__reason">From Profile: {suggestion.profileSource}</p> : null}
                        {suggestion.warnings?.length && (editing || proposedText !== suggestion.proposedText || state === "changed") ? <p className="resume-proposal__reason">Concerns below describe the original proposed wording; edits are not verification.</p> : null}
                        <ContentWarnings warnings={suggestion.warnings} />
                        <EditEvidence resume={resume} suggestion={suggestion} />
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
                              {suggestion.kind === "remove" || suggestion.kind === "reorder" ? null : (
                                <button className="ghost-button is-compact" type="button" disabled={proposalStale} onClick={() => {
                                  setEditingId(suggestion.id);
                                  setDraft(suggestion.proposedText);
                                }}>
                                  <Pencil size={13} aria-hidden="true" /> Edit
                                </button>
                              )}
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
              </section>
            );
          })}
          {decided > 0 ? (
            <p className="resume-proposal__decided-note">
              {decided} of {suggestions.length} decided. Undo returns an edit to this queue.
            </p>
          ) : null}
        </details>
      ) : null}


      {reviewNote}
      {heldBackEdits}
      {result.withheld?.count ? (
        <p className="resume-proposal__withheld">
          {result.withheld.count} generated edit{result.withheld.count === 1 ? " was" : "s were"} withheld because it could not be applied safely.
        </p>
      ) : null}
      {fitGaps}
      {advice}
      {omittedNote}
      {termCoverage}
      {terminologyLimits}
    </div>
  );
}
