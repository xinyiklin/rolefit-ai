import { useEffect, useState } from "react";

import type {
  CoverLetterFailure,
  CoverLetterProposal
} from "../../hooks/useCoverLetter";
import {
  evidenceEntryName,
  type CoverLetterTailorResult
} from "../../lib/coverLetterEvidence";
import type { CoverLetterIssue } from "../../lib/coverLetterFailure";
import type {
  CoverLetterDetailKey,
  CoverLetterPreflight
} from "../../lib/coverLetterPreflight";
import { resolveDocumentWorkflowStatus } from "../../../shared/documentWorkflowContract.ts";
import {
  DocumentWorkflowRail,
  type DocumentWorkflowCheck
} from "../document/DocumentWorkflowRail";
import { ProposalDecisionBar } from "../document/ProposalDecisionBar";
import { ProposalDiff } from "../document/ProposalDiff";
import { ProposalFeedbackList } from "../document/ProposalFeedbackList";

type CoverLetterReviewProps = {
  words: number;
  pageCount: number;
  // The letter currently in the editor, so the proposal can show what accepting
  // would change instead of only what it would leave behind.
  currentText: string;
  preflight: CoverLetterPreflight;
  proposal: CoverLetterProposal | null;
  appliedResult: CoverLetterTailorResult | null;
  failure: CoverLetterFailure | null;
  canRestore: boolean;
  isTailoring: boolean;
  resumeReady: boolean;
  jobReady: boolean;
  providerReady: boolean;
  slotAnswers: Record<string, string>;
  onDetailChange: (key: CoverLetterDetailKey, value: string) => void;
  onSlotAnswerChange: (slotId: string, value: string) => void;
  onTailor: () => void;
  onAcceptProposal: () => void;
  onDiscardProposal: () => void;
  onRestore: () => void;
  onAddHonestContext?: (keyword: string) => void;
  status: string;
};

const FIELD_COPY: Record<
  CoverLetterDetailKey,
  { placeholder: string; maxLength: number }
> = {
  candidate_name: { placeholder: "Name for the sign-off", maxLength: 200 },
  role: { placeholder: "e.g. Software Engineer", maxLength: 300 },
  company: { placeholder: "Employer name", maxLength: 300 }
};

function readiness(label: string, ready: boolean, blockedDetail: string): DocumentWorkflowCheck {
  return {
    label,
    state: ready ? "ready" : "blocked",
    detail: ready ? "Ready" : blockedDetail
  };
}

// Provenance names where a paragraph came from. The evidence item's `entry`
// field is the model's full attribution context — dates, links, stack — so the
// rail shows only its identifying head, never the whole serialized entry.
function proposalEvidence(result: CoverLetterTailorResult, evidenceIds: string[]): string {
  const labels = new Map(
    result.evidenceUsed.map((item) => [
      item.id,
      evidenceEntryName(item.entry)
        || evidenceEntryName(item.section)
        || (item.source === "honest_context" ? "Personal context" : "Resume evidence")
    ])
  );
  return evidenceIds
    .map((id) => id === "source_letter" ? "Current letter" : (labels.get(id) ?? "Verified evidence"))
    .filter((label, index, values) => values.indexOf(label) === index)
    .join(" · ");
}

function issueRecovery(issue: CoverLetterIssue): string {
  if (issue.recovery === "add_evidence") {
    return "Add factual experience in Settings > Guidance, then Polish again.";
  }
  if (issue.recovery === "edit_source") {
    return "Edit the source letter, then Polish again.";
  }
  return "Retry Polish. If it repeats, switch the model or provider.";
}

export function CoverLetterReview({
  words,
  pageCount,
  currentText,
  preflight,
  proposal,
  appliedResult,
  failure,
  canRestore,
  isTailoring,
  resumeReady,
  jobReady,
  providerReady,
  slotAnswers,
  onDetailChange,
  onSlotAnswerChange,
  onTailor,
  onAcceptProposal,
  onDiscardProposal,
  onRestore,
  onAddHonestContext,
  status
}: CoverLetterReviewProps) {
  // The letter is decided whole, so "what changed" is a view of the proposal
  // rather than a per-row marking. It leads, for the same reason the resume's
  // edit list leads: the decision is about the change, not about the artifact.
  const [proposalView, setProposalView] = useState<"changes" | "letter">("changes");
  useEffect(() => {
    setProposalView("changes");
  }, [proposal?.result]);
  const { resolved } = preflight;
  const target = [resolved.role, resolved.company].filter(Boolean).join(" at ") || "Cover letter";
  const ready = preflight.canTailor && resumeReady && jobReady && providerReady;
  // The missing fields render right below this row with their own reasons, so it
  // counts them instead of repeating the first reason verbatim. Template slot
  // questions have no inline field, so those still speak for themselves.
  const fieldCount = preflight.missingFields.length;
  const slotBlocker = preflight.blockers[fieldCount];
  const detailsBlocked = slotBlocker
    ?? (fieldCount > 0 ? `${fieldCount} ${fieldCount === 1 ? "field" : "fields"} below` : "Complete the fields");
  const checks = [
    readiness("Resume", resumeReady, "Add your resume"),
    readiness("Prepared job", jobReady, "Prepare the job"),
    readiness("Polish provider", providerReady, "Check AI settings"),
    readiness("Template details", preflight.canTailor, detailsBlocked)
  ];

  // The letter's proposal is atomic: one accept-or-discard decision, which is
  // 1 of 1 outstanding until it is made. That is how a whole-document
  // replacement rides the same named sequence as the resume's granular edits
  // without pretending to have them.
  const workflow = resolveDocumentWorkflowStatus({
    ready,
    polishing: isTailoring,
    proposal: proposal ? { outstanding: 1, total: 1 } : null,
    proposalSuperseded: Boolean(proposal?.stale)
  });
  const description = isTailoring
    ? "Creating a grounded cover-letter proposal from your evidence."
    : failure || proposal?.stale
        ? ""
        : workflow.state === "stale" && workflow.staleReason === "proposal-superseded"
          ? "The letter's inputs changed after this proposal was created. Polish again before using it."
          : workflow.state === "proposal"
            ? "Your letter changes only if you accept this replacement."
            : workflow.state === "ready-to-polish"
              ? "Polish creates a reviewable proposal from your current letter, resume evidence, and prepared job."
              : workflow.state === "blocked"
                ? "Complete the blocked rows before polishing."
                : "";

  const blockedFailure = failure?.kind === "blocked" ? failure : null;
  const errorFailure = failure?.kind === "error" ? failure : null;
  const failureDetails = blockedFailure ? (
    <ul className="cover-letter-review__issues">
      {blockedFailure.issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`}>
          {issue.claim ? (
            <p className="cover-letter-review__claim">“{issue.claim}”</p>
          ) : null}
          <p className="cover-letter-review__issue-detail">{issue.detail}</p>
          {issue.recovery === "add_evidence" && issue.unsupportedValue && onAddHonestContext ? (
            <button
              type="button"
              className="secondary-button is-compact cover-letter-review__issue-action"
              onClick={() => onAddHonestContext(issue.unsupportedValue!)}
            >
              Add evidence
            </button>
          ) : (
            <p className="cover-letter-review__issue-recovery">{issueRecovery(issue)}</p>
          )}
        </li>
      ))}
    </ul>
  ) : null;

  // Polish itself lives beside the rail's disclosure control, in the header. The
  // footer carries only the decisions an outcome adds — through the same bar the
  // resume commits from, so both documents decide in one place with one verb pair.
  const footer = proposal ? (
    <ProposalDecisionBar
      summary={proposal.stale
        ? "Polish again before accepting"
        : "One change · replaces your whole letter"}
    >
      <button
        type="button"
        className="primary-button is-compact"
        disabled={proposal.stale}
        onClick={onAcceptProposal}
      >
        Accept proposal
      </button>
      <button type="button" className="secondary-button is-compact" onClick={onDiscardProposal}>
        Discard proposal
      </button>
    </ProposalDecisionBar>
  ) : failure ? (
    <button type="button" className="primary-button is-compact" onClick={onTailor}>
      Retry polish
    </button>
  ) : appliedResult && canRestore ? (
    <button type="button" className="secondary-button is-compact" onClick={onRestore}>
      Restore previous
    </button>
  ) : null;

  return (
    <DocumentWorkflowRail
      ariaLabel="Cover letter workflow"
      status={workflow}
      target={target}
      description={description}
      checks={proposal || appliedResult || failure || isTailoring ? [] : checks}
      failure={failure ? {
        title: blockedFailure ? "Evidence check failed" : (errorFailure?.headline ?? "Polish failed"),
        message: blockedFailure
          ? `RoleFit rejected ${blockedFailure.issues.length} ${blockedFailure.issues.length === 1 ? "draft issue" : "draft issues"}${blockedFailure.repairAttempted ? " after one repair attempt" : ""}. Your current letter is unchanged.`
          : "No changes were applied. Your current letter is unchanged.",
        ...(blockedFailure
          ? { details: failureDetails }
          : { items: [errorFailure?.detail ?? "Try Polish again."] })
      } : null}
      footer={footer}
      statusLine={proposal || failure || isTailoring ? undefined : status}
      statusAnnouncement={(proposal && !proposal.stale) || isTailoring ? status : undefined}
    >
      {proposal ? (
        <section className="cover-letter-proposal" aria-label="Proposed replacement">
          <div className="cover-letter-proposal__meta">
            <span>{proposal.result.coverLetterText.trim().split(/\s+/).length} words</span>
            {proposal.result.repaired ? <span>Repaired once</span> : <span>Passed first check</span>}
          </div>
          <ProposalFeedbackList title="Check before using" items={proposal.result.warnings} tone="warning" />
          {proposal.stale ? (
            <p className="cover-letter-proposal__stale" role="status">
              The letter, job, Guidance, or polishing instructions changed. Polish again for the current inputs.
            </p>
          ) : proposal.resumeChanged ? (
            <p className="cover-letter-proposal__stale" role="status">
              Your resume changed after this proposal was created. It was checked against the earlier resume; review the proposal and its evidence before accepting.
            </p>
          ) : null}
          {currentText.trim() ? (
            <div className="proposal-view" role="group" aria-label="Proposal view">
              {([["changes", "Changes"], ["letter", "Full letter"]] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="proposal-view__option"
                  aria-pressed={proposalView === value}
                  onClick={() => setProposalView(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          <div className="cover-letter-proposal__document">
            <p>
              {currentText.trim() && proposalView === "changes" ? (
                <ProposalDiff
                  original={currentText}
                  proposed={proposal.result.coverLetterText}
                  mode="merged"
                />
              ) : (
                proposal.result.coverLetterText
              )}
            </p>
          </div>
          {/* The block had only an aria-label, so a sighted reader met a column
              of "Paragraph N" rows with no statement of what they were. The
              title now matches the other feedback headings in this rail. */}
          <section className="cover-letter-proposal__evidence">
            <h3>Where each paragraph came from</h3>
            <dl>
              {proposal.result.bodyParagraphs.map((paragraph, index) => (
                <div key={`${index}-${paragraph.text.slice(0, 24)}`}>
                  <dt>Paragraph {index + 1}</dt>
                  <dd>{proposalEvidence(proposal.result, paragraph.evidenceIds)}</dd>
                </div>
              ))}
            </dl>
          </section>
          {proposal.result.provider || proposal.result.model ? (
            <p className="cover-letter-proposal__provider">
              {[proposal.result.provider, proposal.result.model].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </section>
      ) : appliedResult && canRestore ? (
        <section className="cover-letter-applied" aria-label="Applied letter summary">
          <p>{words} words · {pageCount === 1 ? "1 page" : `${pageCount || 0} pages`}</p>
          {pageCount > 1 ? <p>Runs {pageCount} pages — shorten before exporting.</p> : null}
          {appliedResult.warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </section>
      ) : (
        <>
          {preflight.missingFields.length > 0 ? (
            <div className="cover-letter-review__fields">
              {preflight.missingFields.map((field) => {
                const id = `cover-letter-detail-${field.key}`;
                return (
                  <label key={field.key} htmlFor={id}>
                    <span>{field.label}</span>
                    <input
                      id={id}
                      maxLength={FIELD_COPY[field.key].maxLength}
                      value={preflight.values[field.key] ?? ""}
                      placeholder={FIELD_COPY[field.key].placeholder}
                      aria-describedby={`${id}-reason`}
                      onChange={(event) => onDetailChange(field.key, event.target.value)}
                    />
                    <small id={`${id}-reason`}>{field.reason}</small>
                  </label>
                );
              })}
            </div>
          ) : null}
          {preflight.privateSlots.length > 0 ? (
            <div className="cover-letter-review__fields">
              {preflight.privateSlots.map((slot) => {
                const id = `cover-template-answer-${slot.id}`;
                return (
                  <label key={slot.id} htmlFor={id}>
                    <span>{slot.normalizedPrompt}</span>
                    <textarea
                      id={id}
                      rows={2}
                      maxLength={2_000}
                      value={slotAnswers[slot.id] ?? ""}
                      placeholder="Only you know this one"
                      onChange={(event) => onSlotAnswerChange(slot.id, event.target.value)}
                    />
                  </label>
                );
              })}
            </div>
          ) : null}
        </>
      )}
    </DocumentWorkflowRail>
  );
}
