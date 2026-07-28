import type { CoverLetterProposal } from "../../lib/coverLetterEvidence";

type CoverLetterProposalProps = {
  proposal: CoverLetterProposal;
  words: number;
  pageCount: number;
  onAccept: () => void;
  onEdit: () => void;
  onDiscard: () => void;
};

function sourceLabel(source: CoverLetterProposal["selectedEvidence"][number]["source"]): string {
  if (source === "honest_context") return "Personal note";
  if (source === "user_answer") return "Your answer";
  return "Resume";
}

export function CoverLetterProposalPanel({
  proposal,
  words,
  pageCount,
  onAccept,
  onEdit,
  onDiscard
}: CoverLetterProposalProps) {
  const onePage = pageCount === 1;
  const lengthReady = words >= 180 && words <= 420;
  const canAccept = proposal.readyToSend && onePage && lengthReady;

  return (
    <div className="cover-letter-proposal">
      <ul className="cover-letter-proposal__checks">
        <li className={onePage ? "is-ok" : ""}>
          {pageCount || 0} {pageCount === 1 ? "page" : "pages"}
          <span>{onePage ? "exact layout check" : "revise before using"}</span>
        </li>
        <li className={lengthReady ? "is-ok" : ""}>
          {words} words <span>configured range 180–420</span>
        </li>
        <li className="is-ok">
          No unresolved placeholders <span>validated server-side</span>
        </li>
        <li className="is-ok">
          Current letter preserved <span>nothing changes until acceptance</span>
        </li>
      </ul>

      <section className="cover-letter-proposal__evidence" aria-labelledby="cover-proposal-evidence">
        <h3 id="cover-proposal-evidence">Evidence used</h3>
        <ul>
          {proposal.selectedEvidence.map((item) => (
            <li key={item.id}>
              <span>{sourceLabel(item.source)}</span>
              <p>{item.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <div className="cover-letter-review__proposal-copy" tabIndex={0} aria-label="Proposed cover letter">
        {proposal.blocks.map((block, index) => (
          <p key={`${block.kind}-${index}`}>{block.text}</p>
        ))}
      </div>

      {proposal.changeSummary.length > 0 ? (
        <section className="cover-letter-proposal__summary">
          <h3>Changed</h3>
          <ul>{proposal.changeSummary.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
        </section>
      ) : null}

      {proposal.preservedFromSource.length > 0 ? (
        <section className="cover-letter-proposal__summary">
          <h3>Preserved</h3>
          <ul>{proposal.preservedFromSource.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
        </section>
      ) : null}

      {proposal.warnings.length > 0 ? (
        <section className="cover-letter-proposal__warnings" role="status">
          <h3>Review</h3>
          <ul>{proposal.warnings.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
        </section>
      ) : null}

      {!canAccept ? (
        <p className="cover-letter-proposal__blocked">
          The proposal is not send-ready at the current document style. Edit details and generate it again.
        </p>
      ) : null}

      <div className="cover-letter-review__proposal-actions">
        <button type="button" className="primary-btn" disabled={!canAccept} onClick={onAccept}>
          Use this draft
        </button>
        <button type="button" className="secondary-btn" onClick={onEdit}>Edit details</button>
        <button type="button" className="secondary-btn" onClick={onDiscard}>Keep current letter</button>
      </div>
    </div>
  );
}
