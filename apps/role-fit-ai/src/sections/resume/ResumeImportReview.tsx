import { lazy, Suspense, useId, useState, type FormEvent } from "react";

import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import type { ResumeImportReview as Review, ResumeImportStatus } from "../../hooks/useResumeImport";
import type { AiStageState } from "../../lib/aiWorkflow.ts";
import { importDocumentTitle, importFindingLocation, importSummary } from "../../lib/resumeImportSession.ts";
import { AiWorkflowProgress } from "../AiWorkflowProgress";

const ResumeImportOriginal = lazy(() => import("./ResumeImportOriginal"));

type InterpretationControls = {
  // The configured Resume import provider and model, named before anything is sent.
  label: string;
  ready: boolean;
  blocker: string;
  state: AiStageState;
  onInterpret: () => void;
  onStop: () => void;
  onDismiss: () => void;
  onShowLocal: () => void;
};

type ResumeImportReviewProps = {
  status: ResumeImportStatus;
  review: Review | null;
  resume: ResumeData;
  existingVariantNames: readonly string[];
  variantFileName: (label: string) => string;
  saving: boolean;
  onSave: (fileName: string) => void;
  onDiscard: () => void;
  onDismissRefusal: () => void;
  onViewOriginal: () => void;
  onHighlight: (fieldKey: string | null) => void;
  interpretation: InterpretationControls;
};

// The Resume rail while a PDF import is read or reviewed. It shares the
// workflow rail's anatomy but not Polish's states: an import reconstructs the
// resume and never proposes changes.
export function ResumeImportReview({
  status,
  review,
  resume,
  existingVariantNames,
  variantFileName,
  saving,
  onSave,
  onDiscard,
  onDismissRefusal,
  onViewOriginal,
  onHighlight,
  interpretation
}: ResumeImportReviewProps) {
  const fieldId = useId();
  const [label, setLabel] = useState(() => (review ? importDocumentTitle(review.fileName) : ""));
  const fileName = variantFileName(label);
  const replaces = Boolean(fileName && existingVariantNames.includes(fileName));

  if (!review) {
    const refused = status.kind === "refused" ? status : null;
    return (
      <aside className={`workflow-rail ${refused ? "is-attention" : "is-working"}`} aria-label="Resume import" aria-busy={!refused}>
        <header className="workflow-rail__intro">
          <p className="workflow-rail__eyebrow">{refused ? "Import stopped" : "Importing PDF"}</p>
          <h2>{status.kind === "idle" ? "" : status.fileName}</h2>
          {refused ? null : <p className="workflow-rail__description">Reading the PDF on this computer. Nothing is sent anywhere.</p>}
        </header>
        {refused ? (
          <section className="workflow-rail__failure" role="alert" aria-label="Import stopped">
            <strong>Nothing was changed</strong>
            <p>{refused.message}</p>
          </section>
        ) : null}
        {refused ? (
          <footer className="workflow-rail__footer">
            <button type="button" className="secondary-button is-compact" onClick={onDismissRefusal}>Dismiss</button>
          </footer>
        ) : null}
      </aside>
    );
  }

  const checks = review.findings.filter((finding) => finding.kind === "check");
  const unplaced = review.findings.filter((finding) => finding.kind === "unplaced");

  function save(event: FormEvent) {
    event.preventDefault();
    if (fileName && !saving) onSave(fileName);
  }

  return (
    <aside className="workflow-rail is-neutral resume-import" aria-label="Resume import review">
      <header className="workflow-rail__intro">
        <p className="workflow-rail__eyebrow">Import review</p>
        <h2>{review.fileName}</h2>
        <p className="workflow-rail__description">
          {importSummary(review.audit)} Nothing is saved until you save it.
        </p>
      </header>

      {status.kind === "reading" ? (
        <p className="workflow-rail__status" role="status">Reading {status.fileName} on this computer…</p>
      ) : null}
      {status.kind === "refused" ? (
        <section className="workflow-rail__failure" role="alert" aria-label="Import stopped">
          <strong>{status.fileName} was not imported</strong>
          <p>{status.message} This review is unchanged.</p>
          <div className="resume-import__actions">
            <button type="button" className="ghost-button is-compact" onClick={onDismissRefusal}>Dismiss</button>
          </div>
        </section>
      ) : null}

      <div className="workflow-rail__body">
        <section className="resume-import__section" aria-label="Original PDF">
          <div className="resume-import__section-head">
            <h3>Original</h3>
            <button type="button" className="ghost-button is-compact" onClick={onViewOriginal}>View larger</button>
          </div>
          <div className="resume-import__original">
            <Suspense fallback={<p className="resume-import__note">Loading the original…</p>}>
              <ResumeImportOriginal url={review.previewUrl} fileName={review.fileName} />
            </Suspense>
          </div>
        </section>

        <section className="resume-import__section" aria-label="Reading">
          <h3>Reading</h3>
          {review.source === "ai" ? (
            <>
              <p className="resume-import__note">
                Structure from {interpretation.label}. Its text was checked against the PDF; check where it was placed.
              </p>
              <div className="resume-import__actions">
                <button type="button" className="ghost-button is-compact" onClick={interpretation.onShowLocal}>
                  Use local reading
                </button>
              </div>
            </>
          ) : (
            <p className="resume-import__note">Read on this computer.</p>
          )}
          {["running", "failed", "stopped"].includes(interpretation.state.status) ? (
            <AiWorkflowProgress
              title="Resume import"
              busy={interpretation.state.status === "running"}
              stages={[{ key: "resume-import", state: interpretation.state, onStop: interpretation.onStop, onRetry: interpretation.onInterpret }]}
              onDismiss={interpretation.onDismiss}
              suspendExpiry
            />
          ) : null}
          {review.source === "local" && interpretation.state.status !== "running" ? (
            <>
              <div className="resume-import__actions">
                <button
                  type="button"
                  className="secondary-button is-compact"
                  disabled={!interpretation.ready || saving}
                  onClick={interpretation.onInterpret}
                >
                  Interpret with {interpretation.label}
                </button>
              </div>
              <p className="resume-import__note">
                {interpretation.ready
                  ? `Sends this PDF's extracted text to ${interpretation.label}. Only structure comes back, and text that doesn't match the PDF is rejected.`
                  : interpretation.blocker || "Set up the Resume import model in Settings."}
              </p>
            </>
          ) : null}
        </section>

        <section className="resume-import__section" aria-label="Check">
          <h3>Check{checks.length ? ` (${checks.length})` : ""}</h3>
          {checks.length ? (
            <ul className="resume-import__list">
              {checks.map((finding) => {
                const location = importFindingLocation(resume, finding.fieldKey);
                const highlight = location.present ? finding.fieldKey : null;
                return (
                  <li
                    key={finding.id}
                    className="resume-import__item"
                    onMouseEnter={() => onHighlight(highlight)}
                    onMouseLeave={() => onHighlight(null)}
                    onFocus={() => onHighlight(highlight)}
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) onHighlight(null);
                    }}
                  >
                    <div className="resume-import__item-head">
                      <p className="resume-import__where">{location.label}</p>
                      {highlight ? (
                        <button type="button" className="ghost-button is-compact" onClick={() => onHighlight(highlight)}>Show</button>
                      ) : null}
                    </div>
                    <p className="resume-import__reason">{finding.reason}</p>
                    {finding.source ? <p className="resume-import__source">{finding.source}</p> : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="resume-import__note">Nothing was flagged. Compare the document with the original before saving.</p>
          )}
        </section>

        {unplaced.length ? (
          <section className="resume-import__section" aria-label="Not placed">
            <h3>Not placed ({unplaced.length})</h3>
            <p className="resume-import__note">This text is in the PDF but not in the document. Add what you need.</p>
            <ul className="resume-import__list">
              {unplaced.map((finding) => (
                <li key={finding.id} className="resume-import__item">
                  <p className="resume-import__source">{finding.text}</p>
                  <p className="resume-import__reason">{finding.reason}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <footer className="workflow-rail__footer resume-import__footer">
        <form className="resume-import__save" onSubmit={save}>
          <label htmlFor={fieldId}>Save as variant</label>
          <input
            id={fieldId}
            type="text"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="e.g. Full stack"
            autoComplete="off"
          />
          {replaces ? (
            <p className="resume-import__note">Replaces the saved {fileName}; the earlier version goes to history.</p>
          ) : null}
          <div className="resume-import__actions">
            <button type="submit" className="primary-button is-compact" disabled={!fileName || saving}>
              {saving ? "Saving…" : "Save variant"}
            </button>
            <button type="button" className="secondary-button is-compact" onClick={onDiscard} disabled={saving}>
              Discard import
            </button>
          </div>
        </form>
      </footer>
    </aside>
  );
}
