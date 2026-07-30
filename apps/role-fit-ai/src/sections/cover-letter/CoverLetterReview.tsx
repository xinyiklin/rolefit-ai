import type { CoverLetterTailorResult } from "../../lib/coverLetterEvidence";
import type {
  CoverLetterDetailKey,
  CoverLetterPreflight
} from "../../lib/coverLetterPreflight";

type CoverLetterReviewProps = {
  words: number;
  pageCount: number;
  preflight: CoverLetterPreflight;
  result: CoverLetterTailorResult | null;
  canRestore: boolean;
  resumeReady: boolean;
  jobReady: boolean;
  providerReady: boolean;
  slotAnswers: Record<string, string>;
  onDetailChange: (key: CoverLetterDetailKey, value: string) => void;
  onSlotAnswerChange: (slotId: string, value: string) => void;
  onRestore: () => void;
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

function readiness(label: string, ready: boolean, hint: string) {
  return { label, ready, hint };
}

export function CoverLetterReview({
  words,
  pageCount,
  preflight,
  result,
  canRestore,
  resumeReady,
  jobReady,
  providerReady,
  slotAnswers,
  onDetailChange,
  onSlotAnswerChange,
  onRestore,
  status
}: CoverLetterReviewProps) {
  const { resolved } = preflight;
  const target = [resolved.role, resolved.company].filter(Boolean).join(" at ");
  const checks = [
    readiness("Resume", resumeReady, "Add your resume"),
    readiness("Job description", jobReady, "Prepare the job on Prepare"),
    readiness("AI provider", providerReady, "Check AI settings")
  ];

  return (
    <aside className="cover-letter-review" aria-label="Cover letter tailoring">
      {result ? (
        <>
          <p className="cover-letter-review__eyebrow">Tailored</p>
          <h2>{target || "This letter"}</h2>
          <ul className="cover-letter-review__checks">
            <li className="is-ok">
              {words} words
              <span>{pageCount === 1 ? "1 page" : `${pageCount || 0} pages`}</span>
            </li>
            <li className="is-ok">
              Evidence checked
              <span>resume and personal context</span>
            </li>
          </ul>
          {pageCount > 1 ? (
            <p className="cover-letter-review__warning">
              Runs {pageCount} pages — shorten before exporting.
            </p>
          ) : null}
          {result.warnings.map((warning) => (
            <p key={warning} className="cover-letter-review__warning">
              {warning}
            </p>
          ))}
          {canRestore ? (
            <button type="button" className="cover-letter-review__restore" onClick={onRestore}>
              Restore previous
            </button>
          ) : null}
          {result.evidenceUsed.length > 0 ? (
            <details className="cover-letter-review__standard">
              <summary>Evidence used</summary>
              <ul>
                {result.evidenceUsed.map((item) => (
                  <li key={item.id}>{item.entry || item.section || item.text}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : (
        <>
          <p className="cover-letter-review__eyebrow">Tailoring</p>
          <h2>{target || "Prepare a job first"}</h2>
          <ul className="cover-letter-review__checks">
            {checks.map((check) => (
              <li key={check.label} className={check.ready ? "is-ok" : ""}>
                {check.label}
                <span>{check.ready ? "Ready" : check.hint}</span>
              </li>
            ))}
          </ul>

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
                      onChange={(event) =>
                        onDetailChange(field.key, event.target.value)
                      }
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

      <details className="cover-letter-review__standard">
        <summary>Writing standard</summary>
        <p>
          Specific interest, real evidence, active voice, no résumé repetition, and a natural
          close.
        </p>
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
