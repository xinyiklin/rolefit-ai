import { useState } from "react";
import { AlertCircle, Check, CheckCheck, Clipboard, PlusCircle, Pencil, RotateCcw, X } from "lucide-react";
import type { PolishedResume, ResumeDiff, StrictReviewRewrite, TailorSuggestion } from "../resumeEngine";
import type { ResumeData, ResumeEntry } from "../lib/resumeData";
import { renderInlineMarks, stripInlineMarks } from "../lib/inlineMarks";
import type { ResumeEditorActions } from "../hooks/useResumeEditor";
import type { TailorChangeTarget } from "../resume/types";
import type { JobConstraint } from "../lib/jobConstraints";

type BulletTarget = { sectionId: string; entryId: string; bulletId: string };

type ReviewRailProps = {
  result: PolishedResume;
  resume: ResumeData | null;
  actions: ResumeEditorActions;
  // Whole-resume original-vs-tailored diff — the anti-fabrication read-through.
  resumeDiff: ResumeDiff | null;
  // Lifestyle/logistical conditions in the JD — shown as a pre-apply advisory,
  // separate from fit (they never move the verdict).
  jobConstraints?: JobConstraint[];
  // True when the JD changed since this review was generated — the verdict and
  // gaps describe an older posting. Does NOT discard the review; just flags it.
  reviewStale?: boolean;
  onHighlight?: (target: TailorChangeTarget | null) => void;
  // Called when the user clicks "Add evidence" on a gap or missing-skill row.
  // Opens the Options menu so they can fill in honest context and re-run Polish.
  onAddHonestContext?: (keyword: string) => void;
};

function evidenceLabel(evidenceType: string | undefined) {
  return (
    {
      exact: "Exact evidence",
      adjacent: "Adjacent evidence",
      none: "No evidence"
    }[evidenceType ?? ""] ?? "Evidence"
  );
}

// Whitespace- and formatting-insensitive: a bullet the user bolded/italicized
// still matches the review's plain-text original.
const normalize = (text: string) => stripInlineMarks(text).replace(/\s+/g, " ").trim().toLowerCase();

// Locate the editor bullet whose text matches `text` (whitespace-insensitive).
// First match wins; duplicate bullets are rare enough that this is acceptable.
function findBullet(resume: ResumeData | null, text: string): BulletTarget | null {
  const wanted = normalize(text);
  if (!resume || !wanted) return null;
  for (const section of resume.sections) {
    for (const entry of section.items) {
      for (const bullet of entry.bullets) {
        if (normalize(bullet.text) === wanted) {
          return { sectionId: section.id, entryId: entry.id, bulletId: bullet.id };
        }
      }
    }
  }
  return null;
}

type EditStatus =
  | { kind: "pending"; target: BulletTarget }
  | { kind: "applied"; appliedText: string }
  | { kind: "stale" };

type SuggestionStatus =
  | { kind: "pending"; currentText: string }
  | { kind: "applied"; appliedText: string }
  | { kind: "discarded" }
  | { kind: "stale"; currentText: string };

type ReviewActionStatus = {
  label: string;
  tone: "ready" | "edits" | "evidence" | "stop";
  title: string;
};

function findEntry(resume: ResumeData | null, sectionId: string, entryId?: string): ResumeEntry | null {
  if (!resume || !entryId) return null;
  const section = resume.sections.find((item) => item.id === sectionId);
  return section?.items.find((entry) => entry.id === entryId) ?? null;
}

function readSuggestionTarget(resume: ResumeData | null, suggestion: TailorSuggestion): string | null {
  const entry = findEntry(resume, suggestion.target.sectionId, suggestion.target.entryId);
  if (!entry) return null;
  if (suggestion.target.field === "bullet") {
    const bullet = entry.bullets.find((item) => item.id === suggestion.target.bulletId);
    return bullet?.text ?? null;
  }
  if (suggestion.target.field === "skill") return entry.subtitleLeft;
  return entry[suggestion.target.field] ?? null;
}

function applySuggestionTarget(actions: ResumeEditorActions, suggestion: TailorSuggestion, value: string) {
  const sectionId = suggestion.target.sectionId;
  const entryId = suggestion.target.entryId;
  if (!entryId) return;
  if (suggestion.target.field === "bullet") {
    if (!suggestion.target.bulletId) return;
    // viaSuggestion: applying a reviewed suggestion must not downgrade the AI
    // fit verdict to "Estimated" (only free-form hand-edits do).
    actions.updateBullet(sectionId, entryId, suggestion.target.bulletId, value, true);
    return;
  }
  const field = suggestion.target.field === "skill" ? "subtitleLeft" : suggestion.target.field;
  actions.updateEntry(sectionId, entryId, field, value, true);
}

function reviewActionStatus(result: PolishedResume, pendingEdits: number): ReviewActionStatus | null {
  const sr = result.strictReview;
  if (!sr) return null;
  if (sr.verdict === "DON'T APPLY") {
    return {
      label: "do not apply",
      tone: "stop",
      title: "The reviewer found a hard mismatch or blocker for this role."
    };
  }

  const missingEvidence =
    sr.gaps.some((gap) => !gap.canHonestlyAdd && (gap.severity === "BLOCKER" || gap.severity === "HIGH")) ||
    Boolean(result.missingRequiredSkills?.some((item) => !item.canHonestlyAdd));
  if (missingEvidence) {
    return {
      label: "missing evidence",
      tone: "evidence",
      title: "The reviewer found requirements the AI cannot safely add without more honest context."
    };
  }

  // pendingEdits blends Tailor + Reviewer pending cards, so the copy stays neutral
  // ("edits", not "reviewer edits", which would misdirect when only Tailor edits
  // are pending). topEdits is advisory prose shown in its own section — it must
  // NOT drive an "edits ready" pill when nothing in the rail is actually applyable.
  if (!sr.recommendation.applyAsIs || pendingEdits > 0) {
    return {
      label: pendingEdits > 0 ? "edits ready" : "edit first",
      tone: "edits",
      title: pendingEdits > 0
        ? "Apply the pending edits in the rail before exporting."
        : "The reviewer recommends another pass before applying."
    };
  }

  return {
    label: "ready to apply",
    tone: "ready",
    title: sr.recommendation.reason || "The tailored draft passed the recruiter-style review."
  };
}

// The recruiter review beside the editor: the verdict plus each suggested
// bullet rewrite as an actionable card — accept it, modify it before applying,
// undo it, or apply everything that still matches. A card goes stale when its
// bullet was hand-edited away (apply manually via Copy in that case).
export function ReviewRail({ result, resume, actions, resumeDiff, jobConstraints, reviewStale, onHighlight, onAddHonestContext }: ReviewRailProps) {
  const sr = result.strictReview;
  const suggestions = result.suggestedChanges ?? [];
  // Text applied per rewrite index (Accept stores the suggestion, Apply after
  // Edit stores the modified text) so "applied" survives later unrelated edits.
  const [appliedTexts, setAppliedTexts] = useState<Record<string, string>>({});
  const [discardedSuggestions, setDiscardedSuggestions] = useState<Record<string, boolean>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyFailedKey, setCopyFailedKey] = useState<string | null>(null);

  if (!sr && !suggestions.length) return null;
  const rewrites = sr?.rewrites ?? [];

  function suggestionKey(suggestion: TailorSuggestion, index: number) {
    // Namespace the suggestion keyspace: suggestion.id is model-supplied and only
    // length-clipped server-side, so it could equal a reviewer rewrite's
    // "rewrite-<n>" key. Both sections share appliedTexts/editingKey/copiedKey, so
    // a bare collision would cross-wire their apply/edit/copy state. The `sugg:`
    // prefix keeps the two keyspaces disjoint.
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
    if (normalize(currentText) === normalize(suggestion.currentText)) {
      return { kind: "pending", currentText };
    }
    return { kind: "stale", currentText };
  }

  function applySuggestion(index: number, text: string) {
    const suggestion = suggestions[index];
    if (!suggestion) return;
    const key = suggestionKey(suggestion, index);
    const status = suggestionStatus(suggestion, index);
    if (status.kind !== "pending") return;
    const value = text.trim();
    if (!value) return;
    applySuggestionTarget(actions, suggestion, value);
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
  }

  function statusFor(rewrite: StrictReviewRewrite, index: number): EditStatus {
    const appliedText = appliedTexts[`rewrite-${index}`];
    if (appliedText !== undefined && findBullet(resume, appliedText)) {
      return { kind: "applied", appliedText };
    }
    const pendingTarget = findBullet(resume, rewrite.original);
    if (pendingTarget) return { kind: "pending", target: pendingTarget };
    // The draft may already contain the suggestion (snapshot restore, or the
    // AI baked it into the polished text) — treat that as applied.
    if (findBullet(resume, rewrite.rewrite)) return { kind: "applied", appliedText: rewrite.rewrite };
    return { kind: "stale" };
  }

  const statuses = rewrites.map((rewrite, index) => statusFor(rewrite, index));
  const suggestionStatuses = suggestions.map((suggestion, index) => suggestionStatus(suggestion, index));
  const pendingSuggestionCount = suggestionStatuses.filter((status) => status.kind === "pending").length;
  const pendingRewriteCount = statuses.filter((status) => status.kind === "pending").length;
  const actionStatus = reviewActionStatus(result, pendingSuggestionCount + pendingRewriteCount);

  function applyEdit(index: number, text: string) {
    const status = statuses[index];
    if (status.kind !== "pending") return;
    const value = text.trim();
    if (!value) return;
    actions.updateBullet(status.target.sectionId, status.target.entryId, status.target.bulletId, value, true);
    setAppliedTexts((current) => ({ ...current, [`rewrite-${index}`]: value }));
    setEditingKey(null);
  }

  function undoEdit(index: number) {
    const status = statuses[index];
    if (status.kind !== "applied") return;
    const target = findBullet(resume, status.appliedText);
    if (!target) return;
    actions.updateBullet(target.sectionId, target.entryId, target.bulletId, rewrites[index].original, true);
    setAppliedTexts((current) => {
      const next = { ...current };
      delete next[`rewrite-${index}`];
      return next;
    });
  }

  function applyAllSuggestions() {
    suggestions.forEach((suggestion, index) => {
      if (suggestionStatus(suggestion, index).kind === "pending") applySuggestion(index, suggestion.proposedText);
    });
  }

  function applyAllRewrites() {
    // Recompute targets per apply: every pending rewrite points at a distinct
    // bullet, so batching the dispatches is safe.
    rewrites.forEach((rewrite, index) => {
      if (statuses[index].kind === "pending") applyEdit(index, rewrite.rewrite);
    });
  }

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
    } catch {
      // Clipboard unavailable — flag the failure so the user knows nothing was
      // copied (the suggestion text stays visible on the card to copy manually).
      setCopyFailedKey(key);
      window.setTimeout(() => setCopyFailedKey((current) => (current === key ? null : current)), 2500);
    }
  }

  return (
    <aside className="review-rail" aria-label="Recruiter review">
      {reviewStale ? (
        <p className="rr-stale-notice" role="status">
          This review reflects a previous job description — re-Polish to refresh.
        </p>
      ) : null}
      {sr ? (
        <>
          <div className={`review-rail__verdict${reviewStale ? " review-rail__verdict--stale" : ""}`}>
            <strong className={`verdict-pill verdict-pill--${sr.verdict.replace(/['\s]+/g, "-").toLowerCase()}`}>
              {sr.verdict}
            </strong>
            {actionStatus ? (
              <span className={`rec-pill rec-pill--${actionStatus.tone}`} title={actionStatus.title}>
                {actionStatus.label}
              </span>
            ) : null}
          </div>
          <p className="review-rail__reason">{sr.verdictReason}</p>
        </>
      ) : (
        <div className={`review-rail__verdict${reviewStale ? " review-rail__verdict--stale" : ""}`}>
          <strong className="verdict-pill verdict-pill--reasonable-fit">Tailor suggestions</strong>
        </div>
      )}
      {result.reviewedBy ? <p className="review-rail__byline">Reviewed by {result.reviewedBy}</p> : null}

      {jobConstraints?.length ? (
        <section className="review-rail__section rr-advisory" aria-label="Before you apply">
          <header className="review-rail__head">
            <h3>Before you apply</h3>
          </header>
          <p className="rr-advisory__note">
            These are the job's conditions, not fit factors — check they work for you.
          </p>
          <ul className="rr-advisory__list">
            {jobConstraints.map((c) => (
              <li key={c.kind} className="rr-advisory__item">
                <AlertCircle size={13} aria-hidden="true" />
                <span>
                  <strong>{c.label}</strong>
                  <span className="rr-advisory__detail">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.changeSummary?.length ? (
        <section className="review-rail__section review-rail__change-summary" aria-label="What changed">
          <header className="review-rail__head">
            <h3>What changed</h3>
          </header>
          <ul className="rr-change-list">
            {result.changeSummary.map((bullet, index) => (
              <li key={index}>{renderInlineMarks(bullet)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Hoisted above both edit sections: the server sets unsupported > 0 exactly
          in the ALL-dropped case (suggestions.length === 0), which is the one
          scenario this note exists for — an all-drop must not look identical to a
          clean "nothing to suggest" pass. Gating it on suggestions.length hid it
          precisely then. */}
      {result.droppedSuggestions && result.droppedSuggestions.unsupported > 0 ? (
        <p className="review-rail__note review-rail__note--withheld" role="status">
          {result.droppedSuggestions.unsupported} AI {result.droppedSuggestions.unsupported === 1 ? "edit was" : "edits were"} withheld — the wording wasn’t supported by your resume or honest context, so the anti-fabrication guardrail dropped {result.droppedSuggestions.unsupported === 1 ? "it" : "them"}. Nothing unverified reached your draft.
        </p>
      ) : null}

      {suggestions.length ? (
        <section className="review-rail__section" aria-label="Tailor edits">
          <header className="review-rail__head">
            <h3>Tailor edits · {suggestions.length}</h3>
            {pendingSuggestionCount > 1 ? (
              <button type="button" className="secondary-button is-compact" onClick={applyAllSuggestions}>
                <CheckCheck size={12} aria-hidden="true" />
                Apply all ({pendingSuggestionCount})
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
                onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onHighlight?.(null); }}
              >
                {status.kind === "stale" ? (
                  <span className="rr-edit__stale-badge" aria-label="Suggestion is stale">stale</span>
                ) : null}
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
                  <p className="rr-edit__rewrite">
                    {renderInlineMarks(status.kind === "applied" ? status.appliedText : suggestion.proposedText)}
                  </p>
                )}
                {!isEditing ? (
                  <div className="mini-chip-list">
                    <span className="mini-chip mini-chip--covered">{suggestion.sectionHeading}</span>
                    <span className="mini-chip mini-chip--covered">{evidenceLabel(suggestion.evidenceType)}</span>
                    <span className={`mini-chip mini-chip--${suggestion.risk === "high" ? "missing" : "covered"}`}>
                      {suggestion.risk} risk
                    </span>
                    {suggestion.hits.map((hit) => (
                      <span className="mini-chip mini-chip--covered" key={hit}>
                        {hit}
                      </span>
                    ))}
                  </div>
                ) : null}
                {suggestion.reason && !isEditing ? <p className="rr-edit__note">{renderInlineMarks(suggestion.reason)}</p> : null}
                <footer className="rr-edit__actions">
                  {status.kind === "pending" && !isEditing ? (
                    <>
                      <button
                        type="button"
                        className="secondary-button is-compact"
                        onClick={() => applySuggestion(index, suggestion.proposedText)}
                      >
                        <Check size={12} aria-hidden="true" />
                        Accept
                      </button>
                      <button
                        type="button"
                        className="ghost-button is-compact"
                        onClick={() => {
                          setEditingKey(key);
                          setDraft(suggestion.proposedText);
                        }}
                      >
                        <Pencil size={12} aria-hidden="true" />
                        Edit
                      </button>
                      <button type="button" className="ghost-button is-compact" onClick={() => discardSuggestion(index)}>
                        <X size={12} aria-hidden="true" />
                        Discard
                      </button>
                    </>
                  ) : null}
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        className="secondary-button is-compact"
                        disabled={!draft.trim()}
                        onClick={() => applySuggestion(index, draft)}
                      >
                        <Check size={12} aria-hidden="true" />
                        Apply
                      </button>
                      <button type="button" className="ghost-button is-compact" onClick={() => setEditingKey(null)}>
                        <X size={12} aria-hidden="true" />
                        Cancel
                      </button>
                    </>
                  ) : null}
                  {status.kind === "applied" ? (
                    <>
                      <span className="rr-edit__state rr-edit__state--applied">
                        <Check size={12} aria-hidden="true" />
                        Applied
                      </span>
                      <button type="button" className="ghost-button is-compact" onClick={() => undoSuggestion(index)}>
                        <RotateCcw size={12} aria-hidden="true" />
                        Undo
                      </button>
                    </>
                  ) : null}
                  {status.kind === "discarded" ? (
                    <>
                      <span className="rr-edit__state">Discarded</span>
                      <button type="button" className="ghost-button is-compact" onClick={() => restoreSuggestion(index)}>
                        <RotateCcw size={12} aria-hidden="true" />
                        Restore
                      </button>
                    </>
                  ) : null}
                  {status.kind === "stale" && !isEditing ? (
                    <>
                      <span className="rr-edit__state rr-edit__state--stale">
                        <AlertCircle size={12} aria-hidden="true" />
                        Target changed
                      </span>
                      <button
                        type="button"
                        className="ghost-button is-compact"
                        onClick={() => copyText(key, suggestion.proposedText)}
                      >
                        <Clipboard size={12} aria-hidden="true" />
                        {copiedKey === key ? "Copied" : copyFailedKey === key ? "Copy failed" : "Copy"}
                      </button>
                    </>
                  ) : null}
                </footer>
              </article>
            );
          })}
        </section>
      ) : null}

      {sr ? (
        <section className="review-rail__section" aria-label="Reviewer edits">
          <header className="review-rail__head">
            <h3>
              Reviewer edits
              {rewrites.length ? ` · ${rewrites.length}` : ""}
            </h3>
            {pendingRewriteCount > 1 ? (
              <button type="button" className="secondary-button is-compact" onClick={applyAllRewrites}>
                <CheckCheck size={12} aria-hidden="true" />
                Apply all ({pendingRewriteCount})
              </button>
            ) : null}
          </header>

          {rewrites.length === 0 ? (
            <p className="review-rail__empty">No second-pass rewrites suggested for this draft.</p>
          ) : (
            rewrites.map((rewrite, index) => {
              const status = statuses[index];
              const rewriteKey = `rewrite-${index}`;
              const isEditing = editingKey === rewriteKey;
              return (
                <article className={`rr-edit rr-edit--${status.kind}`} key={index}>
                  {status.kind === "stale" ? (
                    <span className="rr-edit__stale-badge" aria-label="Suggestion is stale">stale</span>
                  ) : null}
                  <p className="rr-edit__original">{renderInlineMarks(rewrite.original)}</p>
                  {isEditing ? (
                    <textarea
                      className="textarea rr-edit__draft"
                      value={draft}
                      rows={3}
                      aria-label="Modify the suggested rewrite"
                      onChange={(event) => setDraft(event.target.value)}
                    />
                  ) : (
                    <p className="rr-edit__rewrite">
                      {renderInlineMarks(status.kind === "applied" ? status.appliedText : rewrite.rewrite)}
                    </p>
                  )}
                  {rewrite.hits.length && !isEditing ? (
                    <div className="mini-chip-list">
                      {rewrite.hits.map((hit) => (
                        <span className="mini-chip mini-chip--covered" key={hit}>
                          ✓ {hit}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <footer className="rr-edit__actions">
                    {status.kind === "pending" && !isEditing ? (
                      <>
                        <button
                          type="button"
                          className="secondary-button is-compact"
                          onClick={() => applyEdit(index, rewrite.rewrite)}
                        >
                          <Check size={12} aria-hidden="true" />
                          Accept
                        </button>
                        <button
                          type="button"
                          className="ghost-button is-compact"
                          onClick={() => {
                            setEditingKey(rewriteKey);
                            setDraft(rewrite.rewrite);
                          }}
                        >
                          <Pencil size={12} aria-hidden="true" />
                          Edit
                        </button>
                      </>
                    ) : null}
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          className="secondary-button is-compact"
                          disabled={!draft.trim()}
                          onClick={() => applyEdit(index, draft)}
                        >
                          <Check size={12} aria-hidden="true" />
                          Apply
                        </button>
                        <button
                          type="button"
                          className="ghost-button is-compact"
                          onClick={() => setEditingKey(null)}
                        >
                          <X size={12} aria-hidden="true" />
                          Cancel
                        </button>
                      </>
                    ) : null}
                    {status.kind === "applied" ? (
                      <>
                        <span className="rr-edit__state rr-edit__state--applied">
                          <Check size={12} aria-hidden="true" />
                          Applied
                        </span>
                        <button type="button" className="ghost-button is-compact" onClick={() => undoEdit(index)}>
                          <RotateCcw size={12} aria-hidden="true" />
                          Undo
                        </button>
                      </>
                    ) : null}
                    {status.kind === "stale" ? (
                      <>
                        <span className="rr-edit__state rr-edit__state--stale">
                          <AlertCircle size={12} aria-hidden="true" />
                          Bullet changed — apply manually
                        </span>
                        <button
                          type="button"
                          className="ghost-button is-compact"
                          onClick={() => copyText(rewriteKey, rewrite.rewrite)}
                        >
                          <Clipboard size={12} aria-hidden="true" />
                          {copiedKey === rewriteKey ? "Copied" : copyFailedKey === rewriteKey ? "Copy failed" : "Copy"}
                        </button>
                      </>
                    ) : null}
                  </footer>
                </article>
              );
            })
          )}
        </section>
      ) : null}

      {sr?.gaps.length ? (
        <section className="review-rail__section" aria-label="Gaps">
          <header className="review-rail__head">
            <h3>Gaps · {sr.gaps.length}</h3>
          </header>
          {sr.gaps.map((gap, index) => (
            <article className="rr-gap" key={index}>
              <p className="rr-gap__head">
                <span className={`severity-tag severity-tag--${gap.severity.toLowerCase()}`}>{gap.severity}</span>
                <strong>{gap.gap}</strong>
              </p>
              <p className="rr-gap__line">
                <em>{gap.canHonestlyAdd ? "✓ Can honestly add" : "✗ Cannot add"}</em>
                {gap.suggestedEdit ? ` — ${gap.suggestedEdit}` : ""}
              </p>
              {!gap.canHonestlyAdd && onAddHonestContext ? (
                <button
                  type="button"
                  className="ghost-button is-compact rr-gap__evidence-btn"
                  onClick={() => onAddHonestContext(gap.gap)}
                >
                  <PlusCircle size={11} aria-hidden="true" />
                  Add evidence
                </button>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}

      {sr?.riskFlags.length ? (
        <section className="review-rail__section" aria-label="Interview risks">
          <header className="review-rail__head">
            <h3>Interview risks · {sr.riskFlags.length}</h3>
          </header>
          {sr.riskFlags.map((flag, index) => (
            <article className="rr-gap" key={index}>
              <p className="rr-gap__head">
                <strong>{flag.risk}</strong>
              </p>
              {flag.suggestion ? <p className="rr-gap__line">{flag.suggestion}</p> : null}
            </article>
          ))}
        </section>
      ) : null}

      {sr?.recommendation.topEdits.length ? (
        <section className="review-rail__section" aria-label="Top edits">
          <header className="review-rail__head">
            <h3>Top edits</h3>
          </header>
          <ol className="review-rail__list">
            {sr.recommendation.topEdits.map((edit, index) => (
              <li key={index}>{edit}</li>
            ))}
          </ol>
        </section>
      ) : null}

      {result.missingRequiredSkills?.length ? (
        <details className="review-rail__details">
          <summary>Still missing · {result.missingRequiredSkills.length}</summary>
          {result.missingRequiredSkills.map((item, index) => (
            <article className="rr-gap" key={`${item.keyword}-${index}`}>
              <p className="rr-gap__head">
                <strong>{item.keyword}</strong>
                <span className={`mini-chip mini-chip--${item.canHonestlyAdd ? "covered" : "missing"}`}>
                  {item.canHonestlyAdd ? "Exact evidence" : "Leave as gap"}
                </span>
              </p>
              <p className="rr-gap__line">
                <em>{evidenceLabel(item.evidenceType)}</em>
                {item.reason ? ` — ${item.reason}` : ""}
              </p>
              {onAddHonestContext ? (
                <button
                  type="button"
                  className="ghost-button is-compact rr-gap__evidence-btn"
                  onClick={() => onAddHonestContext(item.keyword)}
                >
                  <PlusCircle size={11} aria-hidden="true" />
                  Add evidence
                </button>
              ) : null}
            </article>
          ))}
        </details>
      ) : null}

      {sr?.coverage.length ? (
        <details className="review-rail__details">
          <summary>Coverage · {sr.coverage.length}</summary>
          {sr.coverage.map((row, index) => (
            <p className={`rr-cov rr-cov--${row.status}`} key={`${row.category}-${row.keyword}-${index}`}>
              <em aria-hidden="true">{row.status === "covered" ? "✓" : row.status === "missing" ? "✗" : "⚠"}</em>
              <strong>{row.keyword}</strong>
              <span>{row.where}</span>
            </p>
          ))}
        </details>
      ) : null}

      {resumeDiff ? (
        <details className="review-rail__details">
          <summary>Before / after changes</summary>
          <p className="diff-legend">
            <span className="diff-seg diff-seg--added">added</span>
            <span className="diff-seg diff-seg--removed">removed</span>
            <span>Read every change before exporting — added claims are yours to defend.</span>
          </p>
          <div className="diff-inline" role="region" aria-label="Full resume diff, original versus tailored">
            {resumeDiff.segments.length ? (
              resumeDiff.segments.map((seg, index) =>
                seg.type === "equal" ? (
                  <span key={index}>{seg.text}</span>
                ) : (
                  <span
                    key={index}
                    className={`diff-seg diff-seg--${seg.type}`}
                    title={seg.type === "added" ? "Added by tailoring" : "Removed by tailoring"}
                  >
                    {seg.text}
                  </span>
                )
              )
            ) : (
              <span className="diff-empty">No changes between the original and tailored resume.</span>
            )}
          </div>
          {resumeDiff.metricPrompts.length ? (
            <div className="metric-prompts">
              <h3>Metric prompts to resolve</h3>
              <ul>
                {resumeDiff.metricPrompts.map((item, index) => (
                  <li key={`${index}-${item}`}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </details>
      ) : null}

      {sr?.recommendation.coverLetterAngle ? (
        <section className="review-rail__section" aria-label="Cover letter angle">
          <header className="review-rail__head">
            <h3>Cover letter angle</h3>
          </header>
          <p className="rr-gap__line">{sr.recommendation.coverLetterAngle}</p>
        </section>
      ) : null}
    </aside>
  );
}
