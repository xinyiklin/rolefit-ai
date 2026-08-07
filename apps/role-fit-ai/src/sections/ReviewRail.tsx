import { useState } from "react";
import { AlertCircle, Check, CheckCheck, Clipboard, Pencil, PlusCircle, RotateCcw, X } from "lucide-react";
import type { ResumeData, ResumeEntry } from "@typeset/engine/lib/resumeData.ts";

import type { PolishedResume, ResumeDiff, TailorSuggestion } from "../resumeEngine";
import { renderInlineMarks, stripInlineMarks } from "../lib/inlineMarks";
import type { ResumeEditorActions } from "../hooks/useResumeEditor";
import type { TailorChangeTarget } from "../resume/types";
import type { JobConstraint } from "../lib/jobConstraints";

type ReviewRailProps = {
  result: PolishedResume;
  resume: ResumeData | null;
  actions: ResumeEditorActions;
  resumeDiff: ResumeDiff | null;
  jobConstraints?: JobConstraint[];
  reviewStale?: boolean;
  onHighlight?: (target: TailorChangeTarget | null) => void;
  onProposalChange?: () => void;
  onAddHonestContext?: (keyword: string) => void;
};

type SuggestionStatus =
  | { kind: "pending"; currentText: string }
  | { kind: "applied"; appliedText: string }
  | { kind: "discarded" }
  | { kind: "stale"; currentText: string };

function evidenceLabel(evidenceType: string | undefined) {
  return ({
    exact: "Exact evidence",
    adjacent: "Adjacent evidence",
    none: "No evidence"
  }[evidenceType ?? ""] ?? "Evidence");
}

const normalize = (text: string) => stripInlineMarks(text).replace(/\s+/g, " ").trim().toLowerCase();

function findEntry(resume: ResumeData | null, sectionId: string, entryId?: string): ResumeEntry | null {
  if (!resume || !entryId) return null;
  const section = resume.sections.find((item) => item.id === sectionId);
  return section?.items.find((entry) => entry.id === entryId) ?? null;
}

function readSuggestionTarget(resume: ResumeData | null, suggestion: TailorSuggestion): string | null {
  const entry = findEntry(resume, suggestion.target.sectionId, suggestion.target.entryId);
  if (!entry) return null;
  if (suggestion.target.field === "bullet") {
    return entry.bullets.find((item) => item.id === suggestion.target.bulletId)?.text ?? null;
  }
  if (suggestion.target.field === "skill") return entry.subtitleLeft;
  return entry[suggestion.target.field] ?? null;
}

function applySuggestionTarget(actions: ResumeEditorActions, suggestion: TailorSuggestion, value: string) {
  const { sectionId, entryId } = suggestion.target;
  if (!entryId) return;
  if (suggestion.target.field === "bullet") {
    if (!suggestion.target.bulletId) return;
    actions.updateBullet(sectionId, entryId, suggestion.target.bulletId, value, true);
    return;
  }
  const field = suggestion.target.field === "skill" ? "subtitleLeft" : suggestion.target.field;
  actions.updateEntry(sectionId, entryId, field, value, true);
}

const READINESS_COPY = {
  READY: { label: "Ready", tone: "ready" },
  REVISIONS_RECOMMENDED: { label: "Revisions recommended", tone: "edits" },
  EVIDENCE_NEEDED: { label: "Evidence needed", tone: "evidence" },
  NOT_READY: { label: "Not ready", tone: "evidence" }
} as const;

export function ReviewRail({
  result,
  resume,
  actions,
  resumeDiff,
  jobConstraints,
  reviewStale,
  onHighlight,
  onProposalChange,
  onAddHonestContext
}: ReviewRailProps) {
  const assessment = result.submissionAssessment;
  const suggestions = result.suggestedChanges ?? [];
  const [appliedTexts, setAppliedTexts] = useState<Record<string, string>>({});
  const [discardedSuggestions, setDiscardedSuggestions] = useState<Record<string, boolean>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyFailedKey, setCopyFailedKey] = useState<string | null>(null);
  const unsupportedDropCount = result.droppedSuggestions?.unsupported ?? 0;
  const invalidDropCount = Math.max(0, (result.droppedSuggestions?.total ?? 0) - unsupportedDropCount);

  if (!assessment && !suggestions.length && unsupportedDropCount === 0 && invalidDropCount === 0) return null;

  function suggestionKey(suggestion: TailorSuggestion, index: number) {
    const raw = suggestion.id || `${suggestion.target.sectionId}:${suggestion.target.entryId ?? ""}:${suggestion.target.bulletId ?? ""}:${suggestion.target.field}:${index}`;
    return `sugg:${raw}`;
  }

  function suggestionStatus(suggestion: TailorSuggestion, index: number): SuggestionStatus {
    const key = suggestionKey(suggestion, index);
    if (discardedSuggestions[key]) return { kind: "discarded" };
    const appliedText = appliedTexts[key];
    const currentText = readSuggestionTarget(resume, suggestion);
    if (currentText === null) return { kind: "stale", currentText: "" };
    if (appliedText !== undefined && normalize(currentText) === normalize(appliedText)) {
      return { kind: "applied", appliedText };
    }
    if (normalize(currentText) === normalize(suggestion.proposedText)) {
      return { kind: "applied", appliedText: suggestion.proposedText };
    }
    if (normalize(currentText) === normalize(suggestion.currentText)) return { kind: "pending", currentText };
    return { kind: "stale", currentText };
  }

  function applySuggestion(index: number, text: string) {
    const suggestion = suggestions[index];
    if (!suggestion || suggestionStatus(suggestion, index).kind !== "pending") return;
    const value = text.trim();
    if (!value) return;
    const key = suggestionKey(suggestion, index);
    applySuggestionTarget(actions, suggestion, value);
    onProposalChange?.();
    setAppliedTexts((current) => ({ ...current, [key]: value }));
    setDiscardedSuggestions((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setEditingKey(null);
  }

  function undoSuggestion(index: number) {
    const suggestion = suggestions[index];
    if (!suggestion) return;
    const key = suggestionKey(suggestion, index);
    applySuggestionTarget(actions, suggestion, suggestion.currentText);
    onProposalChange?.();
    setAppliedTexts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function discardSuggestion(index: number) {
    const suggestion = suggestions[index];
    if (!suggestion) return;
    const key = suggestionKey(suggestion, index);
    setDiscardedSuggestions((current) => ({ ...current, [key]: true }));
    onProposalChange?.();
    setEditingKey(null);
  }

  function restoreSuggestion(index: number) {
    const suggestion = suggestions[index];
    if (!suggestion) return;
    const key = suggestionKey(suggestion, index);
    setDiscardedSuggestions((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    onProposalChange?.();
  }

  function applyAllSuggestions() {
    suggestions.forEach((suggestion, index) => {
      if (suggestionStatus(suggestion, index).kind === "pending") applySuggestion(index, suggestion.proposedText);
    });
  }

  async function copyText(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => current === key ? null : current), 1500);
    } catch {
      setCopyFailedKey(key);
      window.setTimeout(() => setCopyFailedKey((current) => current === key ? null : current), 2500);
    }
  }

  const suggestionStatuses = suggestions.map((suggestion, index) => suggestionStatus(suggestion, index));
  const pendingSuggestionCount = suggestionStatuses.filter((status) => status.kind === "pending").length;
  const readiness = assessment ? READINESS_COPY[assessment.readiness] : null;

  return (
    <div className="review-rail">
      {reviewStale ? (
        <p className="rr-stale-notice" role="status">
          This review no longer reflects the current resume or prepared job. Polish again to refresh it.
        </p>
      ) : null}

      <div className={`review-rail__verdict${reviewStale ? " review-rail__verdict--stale" : ""}`}>
        <strong className="verdict-pill">{readiness?.label ?? "Tailor suggestions"}</strong>
        {pendingSuggestionCount > 0 ? (
          <span className="rec-pill rec-pill--edits">{pendingSuggestionCount} {pendingSuggestionCount === 1 ? "edit" : "edits"} ready</span>
        ) : readiness ? (
          <span className={`rec-pill rec-pill--${readiness.tone}`}>Submission review</span>
        ) : null}
      </div>
      {assessment ? <p className="review-rail__reason">{assessment.summary}</p> : null}
      {result.reviewedBy ? <p className="review-rail__byline">Reviewed by {result.reviewedBy}</p> : null}

      {jobConstraints?.length ? (
        <section className="review-rail__section rr-advisory" aria-label="Before you apply">
          <header className="review-rail__head"><h3>Before you apply</h3></header>
          <p className="rr-advisory__note">These are job conditions, separate from candidate fit and document readiness.</p>
          <ul className="rr-advisory__list">
            {jobConstraints.map((constraint) => (
              <li key={constraint.kind} className="rr-advisory__item">
                <AlertCircle size={13} aria-hidden="true" />
                <span><strong>{constraint.label}</strong><span className="rr-advisory__detail">{constraint.detail}</span></span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.changeSummary?.length ? (
        <section className="review-rail__section review-rail__change-summary" aria-label="What changed">
          <header className="review-rail__head"><h3>What changed</h3></header>
          <ul className="rr-change-list">
            {result.changeSummary.map((bullet, index) => <li key={index}>{renderInlineMarks(bullet)}</li>)}
          </ul>
        </section>
      ) : null}

      {unsupportedDropCount > 0 ? (
        <p className="review-rail__note review-rail__note--withheld" role="status">
          {unsupportedDropCount} AI {unsupportedDropCount === 1 ? "edit was" : "edits were"} withheld because the wording was not supported by your resume or honest context.
        </p>
      ) : null}
      {invalidDropCount > 0 ? (
        <p className="review-rail__note review-rail__note--withheld" role="status">
          {invalidDropCount} AI {invalidDropCount === 1 ? "edit could" : "edits could"} not be applied safely because {invalidDropCount === 1 ? "it was" : "they were"} malformed, redundant, unchanged, or unmatched.
        </p>
      ) : null}

      {suggestions.length ? (
        <section className="review-rail__section" aria-label="Tailor edits">
          <header className="review-rail__head">
            <h3>Tailor edits · {suggestions.length}</h3>
            {pendingSuggestionCount > 1 ? (
              <button type="button" className="secondary-button is-compact" onClick={applyAllSuggestions}>
                <CheckCheck size={12} aria-hidden="true" /> Apply all ({pendingSuggestionCount})
              </button>
            ) : null}
          </header>

          {suggestions.map((suggestion, index) => {
            const status = suggestionStatuses[index];
            const key = suggestionKey(suggestion, index);
            const isEditing = editingKey === key;
            return (
              <article
                className={`rr-edit rr-edit--${status.kind}`}
                key={key}
                onMouseEnter={() => onHighlight?.(suggestion.target)}
                onMouseLeave={() => onHighlight?.(null)}
                onFocus={() => onHighlight?.(suggestion.target)}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onHighlight?.(null);
                }}
              >
                {status.kind === "stale" ? <span className="rr-edit__stale-badge">stale</span> : null}
                <p className="rr-edit__original">{renderInlineMarks(suggestion.currentText)}</p>
                {isEditing ? (
                  <textarea
                    className="textarea rr-edit__draft"
                    value={draft}
                    rows={3}
                    aria-label="Modify the suggested change"
                    onChange={(event) => setDraft(event.target.value)}
                  />
                ) : (
                  <p className="rr-edit__rewrite">{renderInlineMarks(status.kind === "applied" ? status.appliedText : suggestion.proposedText)}</p>
                )}
                {!isEditing ? (
                  <div className="mini-chip-list">
                    <span className="mini-chip mini-chip--covered">{suggestion.sectionHeading}</span>
                    <span className="mini-chip mini-chip--covered">{evidenceLabel(suggestion.evidenceType)}</span>
                    <span className={`mini-chip mini-chip--${suggestion.risk === "high" ? "missing" : "covered"}`}>{suggestion.risk} risk</span>
                    {suggestion.hits.map((hit) => <span className="mini-chip mini-chip--covered" key={hit}>{hit}</span>)}
                  </div>
                ) : null}
                {suggestion.reason && !isEditing ? <p className="rr-edit__note">{renderInlineMarks(suggestion.reason)}</p> : null}
                <footer className="rr-edit__actions">
                  {status.kind === "pending" && !isEditing ? (
                    <>
                      <button type="button" className="secondary-button is-compact" onClick={() => applySuggestion(index, suggestion.proposedText)}><Check size={12} aria-hidden="true" /> Accept</button>
                      <button type="button" className="ghost-button is-compact" onClick={() => { setEditingKey(key); setDraft(suggestion.proposedText); }}><Pencil size={12} aria-hidden="true" /> Edit</button>
                      <button type="button" className="ghost-button is-compact" onClick={() => discardSuggestion(index)}><X size={12} aria-hidden="true" /> Discard</button>
                    </>
                  ) : null}
                  {isEditing ? (
                    <>
                      <button type="button" className="secondary-button is-compact" disabled={!draft.trim()} onClick={() => applySuggestion(index, draft)}><Check size={12} aria-hidden="true" /> Apply</button>
                      <button type="button" className="ghost-button is-compact" onClick={() => setEditingKey(null)}><X size={12} aria-hidden="true" /> Cancel</button>
                    </>
                  ) : null}
                  {status.kind === "applied" ? (
                    <><span className="rr-edit__state rr-edit__state--applied"><Check size={12} aria-hidden="true" /> Applied</span><button type="button" className="ghost-button is-compact" onClick={() => undoSuggestion(index)}><RotateCcw size={12} aria-hidden="true" /> Undo</button></>
                  ) : null}
                  {status.kind === "discarded" ? (
                    <><span className="rr-edit__state">Discarded</span><button type="button" className="ghost-button is-compact" onClick={() => restoreSuggestion(index)}><RotateCcw size={12} aria-hidden="true" /> Restore</button></>
                  ) : null}
                  {status.kind === "stale" && !isEditing ? (
                    <><span className="rr-edit__state rr-edit__state--stale"><AlertCircle size={12} aria-hidden="true" /> Target changed</span><button type="button" className="ghost-button is-compact" onClick={() => copyText(key, suggestion.proposedText)}><Clipboard size={12} aria-hidden="true" /> {copiedKey === key ? "Copied" : copyFailedKey === key ? "Copy failed" : "Copy"}</button></>
                  ) : null}
                </footer>
              </article>
            );
          })}
        </section>
      ) : null}

      {assessment?.unsupportedClaims.length ? (
        <section className="review-rail__section" aria-label="Unsupported claims">
          <header className="review-rail__head"><h3>Unsupported claims · {assessment.unsupportedClaims.length}</h3></header>
          <ul className="review-rail__list">{assessment.unsupportedClaims.map((claim) => <li key={claim}>{claim}</li>)}</ul>
        </section>
      ) : null}

      {assessment?.missingEvidence.length ? (
        <section className="review-rail__section" aria-label="Missing evidence">
          <header className="review-rail__head"><h3>Missing evidence · {assessment.missingEvidence.length}</h3></header>
          {assessment.missingEvidence.map((item) => (
            <article className="rr-gap" key={item}>
              <p className="rr-gap__head"><strong>{item}</strong></p>
              {onAddHonestContext ? (
                <button type="button" className="ghost-button is-compact rr-gap__evidence-btn" onClick={() => onAddHonestContext(item)}>
                  <PlusCircle size={11} aria-hidden="true" /> Add evidence
                </button>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}

      {assessment?.presentationIssues.length ? (
        <section className="review-rail__section" aria-label="Presentation issues">
          <header className="review-rail__head"><h3>Presentation issues</h3></header>
          <ul className="review-rail__list">{assessment.presentationIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        </section>
      ) : null}

      {assessment?.topEdits.length ? (
        <section className="review-rail__section" aria-label="Top edits">
          <header className="review-rail__head"><h3>Top edits</h3></header>
          <ol className="review-rail__list">{assessment.topEdits.map((edit) => <li key={edit}>{edit}</li>)}</ol>
        </section>
      ) : null}

      {assessment?.requirementVisibility.length ? (
        <details className="review-rail__details">
          <summary>Requirement visibility · {assessment.requirementVisibility.length}</summary>
          {assessment.requirementVisibility.map((row) => (
            <div className={`rr-cov rr-cov--${row.coverage.toLowerCase()}`} key={row.id}>
              <em aria-hidden="true">{row.coverage === "COVERED" ? "✓" : row.coverage === "MISSING" ? "✗" : "⚠"}</em>
              <strong>{row.requirement}</strong>
              <span>{row.explanation}</span>
            </div>
          ))}
        </details>
      ) : null}

      {resumeDiff ? (
        <details className="review-rail__details">
          <summary>Before / after changes</summary>
          <p className="diff-legend">
            <span className="diff-seg diff-seg--added">added</span>
            <span className="diff-seg diff-seg--removed">removed</span>
            <span>Read every change before exporting. Added claims are yours to defend.</span>
          </p>
          <div className="diff-inline" role="region" aria-label="Full resume diff, original versus tailored">
            {resumeDiff.segments.length ? resumeDiff.segments.map((segment, index) => segment.type === "equal" ? (
              <span key={index}>{segment.text}</span>
            ) : (
              <span key={index} className={`diff-seg diff-seg--${segment.type}`}>{segment.text}</span>
            )) : <span className="diff-empty">No changes between the original and tailored resume.</span>}
          </div>
          {resumeDiff.metricPrompts.length ? (
            <div className="metric-prompts"><h3>Metric prompts to resolve</h3><ul>{resumeDiff.metricPrompts.map((item) => <li key={item}>{item}</li>)}</ul></div>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}
