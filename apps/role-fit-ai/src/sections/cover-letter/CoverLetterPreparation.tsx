import type {
  CoverLetterEvidenceItem,
  CoverLetterPreparation,
  EvidenceDecision
} from "../../lib/coverLetterEvidence";

type CoverLetterPreparationProps = {
  preparation: CoverLetterPreparation;
  evidence: CoverLetterEvidenceItem[];
  clarificationAnswers: Record<string, string>;
  isWorking: boolean;
  onClarificationChange: (evidenceId: string, value: string) => void;
  onEvidenceDecisionChange: (evidenceId: string, decision: "use" | "skip") => void;
  onPrepare: () => void;
  onDraft: () => void;
};

function evidenceLabel(item: CoverLetterEvidenceItem): string {
  return item.entry || item.section || (item.source === "honest_context" ? "Personal note" : "Resume");
}

function EvidenceRow({
  decision,
  item,
  action,
  actionLabel,
  disabled = false
}: {
  decision: EvidenceDecision;
  item: CoverLetterEvidenceItem;
  action: () => void;
  actionLabel: string;
  disabled?: boolean;
}) {
  return (
    <li className="cover-letter-evidence">
      <div className="cover-letter-evidence__head">
        <span className={`cover-letter-evidence__source is-${item.source}`}>
          {evidenceLabel(item)}
        </span>
        <button
          type="button"
          className="cover-letter-evidence__action"
          disabled={disabled}
          onClick={action}
        >
          {actionLabel}
        </button>
      </div>
      <p className="cover-letter-evidence__text">{item.text}</p>
      <p className="cover-letter-evidence__reason">
        {decision.relevance} · {decision.reason}
      </p>
    </li>
  );
}

export function CoverLetterPreparationPanel({
  preparation,
  evidence,
  clarificationAnswers,
  isWorking,
  onClarificationChange,
  onEvidenceDecisionChange,
  onPrepare,
  onDraft
}: CoverLetterPreparationProps) {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const selected = preparation.plan.decisions.filter((decision) => decision.decision === "use");
  const skipped = preparation.plan.decisions.filter((decision) => decision.decision === "skip");
  const clarificationReady = preparation.clarifications.every(
    (field) => clarificationAnswers[field.evidenceId]?.trim()
  );

  return (
    <div className="cover-letter-preparation">
      <div className="cover-letter-preparation__angle">
        <span>Opening angle</span>
        <p>{preparation.plan.openingAngle}</p>
      </div>

      {preparation.clarifications.length > 0 ? (
        <div className="cover-letter-preparation__clarifications">
          <h3>Clarify before drafting</h3>
          {preparation.clarifications.map((field) => (
            <label key={field.evidenceId} htmlFor={`cover-clarification-${field.evidenceId}`}>
              <span>{field.label}</span>
              <small>{field.reason}</small>
              <textarea
                id={`cover-clarification-${field.evidenceId}`}
                rows={3}
                value={clarificationAnswers[field.evidenceId] ?? ""}
                onChange={(event) => onClarificationChange(field.evidenceId, event.target.value)}
              />
            </label>
          ))}
          <button
            type="button"
            className="cover-letter-rail-button is-primary"
            disabled={!clarificationReady || isWorking}
            onClick={onPrepare}
          >
            {isWorking ? "Updating plan…" : "Update evidence plan"}
          </button>
        </div>
      ) : null}

      <section className="cover-letter-preparation__group" aria-labelledby="cover-evidence-used">
        <div className="cover-letter-preparation__group-head">
          <h3 id="cover-evidence-used">Using</h3>
          <span>{selected.length} of {preparation.plan.decisions.length}</span>
        </div>
        <ul>
          {selected.map((decision) => {
            const item = evidenceById.get(decision.evidenceId);
            return item ? (
              <EvidenceRow
                key={decision.evidenceId}
                decision={decision}
                item={item}
                action={() => onEvidenceDecisionChange(decision.evidenceId, "skip")}
                actionLabel="Skip"
              />
            ) : null;
          })}
        </ul>
      </section>

      <details className="cover-letter-preparation__skipped">
        <summary>Skipped evidence · {skipped.length}</summary>
        <ul>
          {skipped.map((decision) => {
            const item = evidenceById.get(decision.evidenceId);
            return item ? (
              <EvidenceRow
                key={decision.evidenceId}
                decision={decision}
                item={item}
                action={() => onEvidenceDecisionChange(decision.evidenceId, "use")}
                actionLabel="Use"
                disabled={selected.length >= 3}
              />
            ) : null;
          })}
        </ul>
      </details>

      {preparation.status === "ready" ? (
        <button
          type="button"
          className="cover-letter-rail-button is-primary"
          disabled={selected.length < 1 || selected.length > 3 || isWorking}
          onClick={onDraft}
        >
          {isWorking ? "Drafting…" : "Continue to draft"}
        </button>
      ) : null}
    </div>
  );
}
