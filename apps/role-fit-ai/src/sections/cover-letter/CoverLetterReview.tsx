import type {
  CoverLetterEvidenceItem,
  CoverLetterPreparation,
  CoverLetterProposal
} from "../../lib/coverLetterEvidence";
import type {
  CoverLetterPreparationFieldKey,
  CoverLetterPreflight,
  CoverLetterSourceMode
} from "../../lib/coverLetterPreflight";
import { CoverLetterPreparationPanel } from "./CoverLetterPreparation";
import { CoverLetterProposalPanel } from "./CoverLetterProposal";

type CoverLetterReviewProps = {
  words: number;
  pageCount: number;
  proposalPageCount: number;
  preflight: CoverLetterPreflight;
  evidence: CoverLetterEvidenceItem[];
  preparation: CoverLetterPreparation | null;
  proposal: CoverLetterProposal | null;
  proposalWords: number;
  clarificationAnswers: Record<string, string>;
  isWorking: boolean;
  onSourceModeChange: (mode: CoverLetterSourceMode) => void;
  onPreparationFieldChange: (key: CoverLetterPreparationFieldKey, value: string) => void;
  onClarificationChange: (evidenceId: string, value: string) => void;
  onEvidenceDecisionChange: (evidenceId: string, decision: "use" | "skip") => void;
  onPrepare: () => void;
  onDraft: () => void;
  onAcceptProposal: () => void;
  onEditProposal: () => void;
  onDiscardProposal: () => void;
  status: string;
};

const FIELD_COPY: Partial<
  Record<
    CoverLetterPreparationFieldKey,
    {
      label: string;
      placeholder: string;
      multiline?: boolean;
      maxLength: number;
    }
  >
> = {
  candidate_name: {
    label: "Candidate name",
    placeholder: "Name for the sign-off",
    maxLength: 200
  },
  role: { label: "Role", placeholder: "e.g. Software Engineer", maxLength: 300 },
  company: { label: "Company", placeholder: "Employer name", maxLength: 300 },
  recipient_name: {
    label: "Hiring contact (optional)",
    placeholder: "Leave blank to use Hiring Team",
    maxLength: 300
  },
  why_role: {
    label: "Why this role?",
    placeholder: "What genuinely interests you about this work?",
    multiline: true,
    maxLength: 2_000
  },
  lead_experience: {
    label: "Experience to lead with",
    placeholder: "One or two verified experiences to emphasize",
    multiline: true,
    maxLength: 4_000
  },
  tone: {
    label: "Tone (optional)",
    placeholder: "e.g. direct and conversational",
    maxLength: 500
  }
};

export function CoverLetterReview({
  words,
  pageCount,
  proposalPageCount,
  preflight,
  evidence,
  preparation,
  proposal,
  proposalWords,
  clarificationAnswers,
  isWorking,
  onSourceModeChange,
  onPreparationFieldChange,
  onClarificationChange,
  onEvidenceDecisionChange,
  onPrepare,
  onDraft,
  onAcceptProposal,
  onEditProposal,
  onDiscardProposal,
  status
}: CoverLetterReviewProps) {
  const preparationKeys: CoverLetterPreparationFieldKey[] =
    preflight.sourceMode === "guided_draft"
      ? [
          "candidate_name",
          "role",
          "company",
          "recipient_name",
          "why_role",
          "lead_experience",
          "tone"
        ]
      : ["candidate_name", "role", "company", "recipient_name", "tone"];
  const resolvedValues: Partial<Record<CoverLetterPreparationFieldKey, string>> = {
    candidate_name: preflight.values.candidate_name ?? preflight.resolved.candidateName,
    role: preflight.values.role ?? preflight.resolved.role,
    company: preflight.values.company ?? preflight.resolved.company,
    recipient_name: preflight.values.recipient_name ?? "",
    why_role: preflight.values.why_role ?? "",
    lead_experience: preflight.values.lead_experience ?? "",
    tone: preflight.values.tone ?? ""
  };

  const eyebrow = proposal ? "Draft ready" : preparation ? "Evidence plan" : "Tailoring readiness";
  const heading = proposal
    ? "Review the proposal"
    : preparation
      ? preparation.status === "needs_input"
        ? "Clarify the plan"
        : "Choose the evidence"
      : preflight.sourceMode === "guided_draft"
        ? "Complete your brief"
        : "Polish your letter";

  return (
    <aside className="cover-letter-review" aria-label="Cover letter tailoring readiness">
      <p className="cover-letter-review__eyebrow">{eyebrow}</p>
      <h2>{heading}</h2>

      {proposal ? (
        <CoverLetterProposalPanel
          proposal={proposal}
          words={proposalWords}
          pageCount={proposalPageCount}
          onAccept={onAcceptProposal}
          onEdit={onEditProposal}
          onDiscard={onDiscardProposal}
        />
      ) : preparation ? (
        <CoverLetterPreparationPanel
          preparation={preparation}
          evidence={evidence}
          clarificationAnswers={clarificationAnswers}
          isWorking={isWorking}
          onClarificationChange={onClarificationChange}
          onEvidenceDecisionChange={onEvidenceDecisionChange}
          onPrepare={onPrepare}
          onDraft={onDraft}
        />
      ) : (
        <>
          <div className="cover-letter-review__mode-picker" role="group" aria-label="Writing source">
            <button
              type="button"
              className={preflight.sourceMode === "authored_letter" ? "is-active" : ""}
              aria-pressed={preflight.sourceMode === "authored_letter"}
              onClick={() => onSourceModeChange("authored_letter")}
            >
              Polish my letter
            </button>
            <button
              type="button"
              className={preflight.sourceMode === "guided_draft" ? "is-active" : ""}
              aria-pressed={preflight.sourceMode === "guided_draft"}
              onClick={() => onSourceModeChange("guided_draft")}
            >
              Guide a draft
            </button>
          </div>
          <p className="cover-letter-review__mode">
            {preflight.sourceMode === "guided_draft"
              ? "Guided draft · your answers anchor the writing"
              : "Authored letter · your existing voice stays primary"}
          </p>
          <div className="cover-letter-review__resolved" aria-label="Resolved correspondence details">
            <span>{preflight.resolved.date}</span>
            <span>{preflight.resolved.greeting}</span>
          </div>
          <div className="cover-letter-review__fields">
            {preparationKeys.map((key) => {
              const copy = FIELD_COPY[key];
              if (!copy) return null;
              const id = `cover-letter-preparation-${key}`;
              const missingField = preflight.missingFields.find((item) => item.key === key);
              const describedBy = missingField ? `${id}-reason` : undefined;
              return (
                <label key={key} htmlFor={id}>
                  <span>
                    {copy.label}
                    {missingField?.required ? " · Required" : ""}
                  </span>
                  {copy.multiline ? (
                    <textarea
                      id={id}
                      rows={3}
                      maxLength={copy.maxLength}
                      aria-describedby={describedBy}
                      value={resolvedValues[key] ?? ""}
                      placeholder={copy.placeholder}
                      onChange={(event) => onPreparationFieldChange(key, event.target.value)}
                    />
                  ) : (
                    <input
                      id={id}
                      maxLength={copy.maxLength}
                      aria-describedby={describedBy}
                      value={resolvedValues[key] ?? ""}
                      placeholder={copy.placeholder}
                      onChange={(event) => onPreparationFieldChange(key, event.target.value)}
                    />
                  )}
                  {missingField ? <small id={describedBy}>{missingField.reason}</small> : null}
                </label>
              );
            })}
          </div>

          <ul className="cover-letter-review__checks">
            <li className={words >= 200 && words <= 400 ? "is-ok" : ""}>
              {words || 0} words <span>source guidance 200–400</span>
            </li>
            <li className={pageCount === 1 ? "is-ok" : ""}>
              {pageCount || 0} {pageCount === 1 ? "page" : "pages"}
              <span>keep it to one page</span>
            </li>
            <li className={preflight.hasCompletedGreeting ? "is-ok" : ""}>
              Direct greeting <span>resolved safely when no person is named</span>
            </li>
            <li className={preflight.placeholders.length === 0 ? "is-ok" : ""}>
              No source placeholders <span>guided prompts never enter the model</span>
            </li>
          </ul>
        </>
      )}

      <p className="cover-letter-review__note">
        Preparation selects evidence first. Drafting cannot see skipped personal notes or résumé items.
      </p>
      <details className="cover-letter-review__standard">
        <summary>Writing standard</summary>
        <p>Specific interest, selected evidence, active voice, no résumé repetition, and a natural close.</p>
        <a
          href="https://capd.mit.edu/resources/career-toolkit-writing-a-cover-letter/"
          target="_blank"
          rel="noreferrer"
        >
          MIT CAPD guidance
        </a>
        <a
          href="https://cloudfront.careeronestop.org/JobSearch/Resumes/cover-letters.aspx"
          target="_blank"
          rel="noreferrer"
        >
          CareerOneStop guidance
        </a>
      </details>
      <p className="cover-letter-review__status" aria-live="polite">
        {status}
      </p>
    </aside>
  );
}
