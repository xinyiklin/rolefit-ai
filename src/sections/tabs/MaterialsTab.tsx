import { useEffect, useState } from "react";
import { Clipboard, Plus, Sparkles, X } from "lucide-react";
import type { ApplicationAnswersResult } from "../shared";

const DEFAULT_QUESTIONS = [
  "Why do you want to work for us?",
  "Why are you interested in this role?",
  "What makes you a strong fit for this role?",
  "Describe a project or accomplishment relevant to this role."
];

type AnswerDraft = { question: string; answer: string; needsInput: boolean; save: boolean };
type RoleDraft = { role: string; description: string; needsInput: boolean; save: boolean };

export type MaterialsTabProps = {
  // The current cover letter (from polish OR on-demand generation) — one source.
  coverLetterText: string;
  onGenerateCoverLetter: () => void;
  isGeneratingCover: boolean;
  coverStatus: string;
  includeCoverLetter: boolean;
  setIncludeCoverLetter: (v: boolean) => void;
  coverCopied: boolean;
  onCopy: () => void | Promise<void>;
  answersResult: ApplicationAnswersResult;
  answersStatus: string;
  isGeneratingAnswers: boolean;
  resumeReady: boolean;
  jobReady: boolean;
  canSave: boolean;
  onGenerate: (opts: { questions: string[]; includeRoleDescriptions: boolean }) => void;
  onSaveAnswers: (items: { question: string; answer: string }[]) => void;
  jobTarget?: { role?: string; company?: string };
};

export function MaterialsTab({
  coverLetterText,
  onGenerateCoverLetter,
  isGeneratingCover,
  coverStatus,
  includeCoverLetter,
  setIncludeCoverLetter,
  coverCopied,
  onCopy,
  answersResult,
  answersStatus,
  isGeneratingAnswers,
  resumeReady,
  jobReady,
  canSave,
  onGenerate,
  onSaveAnswers,
  jobTarget
}: MaterialsTabProps) {
  // ---- Plan state ----
  // Questions start unchecked — the user opts in to the ones they want to draft.
  const [selected, setSelected] = useState<boolean[]>(() => DEFAULT_QUESTIONS.map(() => false));
  const [customs, setCustoms] = useState<string[]>([]);
  const [newCustom, setNewCustom] = useState("");
  const [includeRoles, setIncludeRoles] = useState(true);

  // ---- Drafts state ----
  const [drafts, setDrafts] = useState<AnswerDraft[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<RoleDraft[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyFailedKey, setCopyFailedKey] = useState<string | null>(null);

  // Reset when a fresh generation arrives
  useEffect(() => {
    setDrafts((answersResult?.answers ?? []).map((a) => ({ ...a, save: false })));
    setRoleDrafts((answersResult?.roleDescriptions ?? []).map((r) => ({ ...r, save: false })));
  }, [answersResult]);

  // ---- Helpers ----
  function buildQuestionList() {
    const chosen = DEFAULT_QUESTIONS.filter((_, i) => selected[i]);
    const extra = customs.map((c) => c.trim()).filter(Boolean);
    return [...chosen, ...extra];
  }

  function handleGenerate() {
    onGenerate({ questions: buildQuestionList(), includeRoleDescriptions: includeRoles });
  }

  function addCustom() {
    const value = newCustom.trim();
    if (!value) return;
    setCustoms((c) => [...c, value]);
    setNewCustom("");
  }

  async function copy(key: string, text: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      // Clipboard API unavailable (non-secure context): tell the user it didn't
      // land so they don't paste stale content into a real application.
      setCopyFailedKey(key);
      window.setTimeout(() => setCopyFailedKey((k) => (k === key ? null : k)), 2500);
    }
  }

  function handleSaveAnswers() {
    const items = [
      ...drafts
        .filter((d) => d.save && d.answer.trim())
        .map((d) => ({ question: d.question, answer: d.answer.trim() })),
      ...roleDrafts
        .filter((r) => r.save && r.description.trim())
        .map((r) => ({ question: `Role description: ${r.role}`, answer: r.description.trim() }))
    ];
    if (items.length) onSaveAnswers(items);
  }

  // ---- Derived ----
  const hasCoverDraft = Boolean(coverLetterText);
  const canGenerate = resumeReady && jobReady;
  const gateHint = canGenerate
    ? ""
    : resumeReady
    ? "Add the job description (Job menu, top bar) first."
    : jobReady
    ? "Add your resume first."
    : "Add your resume and the job description first.";
  const nothingChosen = buildQuestionList().length === 0 && !includeRoles;
  const hasAnswerDrafts = drafts.length > 0 || roleDrafts.length > 0;
  const selectedToSave =
    drafts.filter((d) => d.save).length + roleDrafts.filter((r) => r.save).length;

  // Cover letter plan-row badge (separate from the generation status message).
  function coverLetterBadge() {
    if (hasCoverDraft) return "drafted";
    if (includeCoverLetter) return "pending";
    return null;
  }
  const coverBadge = coverLetterBadge();

  // Target meta line
  const targetLine =
    jobTarget?.role && jobTarget?.company
      ? `For ${jobTarget.role} at ${jobTarget.company}`
      : jobTarget?.role
      ? `For ${jobTarget.role}`
      : jobTarget?.company
      ? `At ${jobTarget.company}`
      : null;

  return (
    <section className="workspace-page materials-page">
      <header className="workspace-page__head">
        <h2 className="page-serif">Materials</h2>
        {targetLine ? (
          <span className="materials-page__meta">{targetLine}</span>
        ) : (
          <span className="materials-page__meta">Load a job to tailor drafts</span>
        )}
      </header>

      <div className="materials-layout">
        {/* ---- Left column: Drafts ---- */}
        <div className="materials-drafts">
          {hasAnswerDrafts || hasCoverDraft ? (
            <>
              {hasAnswerDrafts ? (
                <div className="drafts-head">
                  <span className="drafts-head__label">Drafts</span>
                  <button
                    className="secondary-button is-compact"
                    type="button"
                    onClick={handleSaveAnswers}
                    disabled={!canSave || selectedToSave === 0}
                    title={canSave ? undefined : "Apply this job first, or add a job link."}
                  >
                    {selectedToSave
                      ? `Save ${selectedToSave} to application`
                      : "Select to save"}
                  </button>
                </div>
              ) : null}

              {/* Cover letter sheet — first when present */}
              {hasCoverDraft ? (
                <article className="draft-sheet draft-sheet--letter">
                  <div className="draft-sheet__head">
                    <div className="draft-sheet__meta">
                      <span className="draft-sheet__kind">Cover letter</span>
                    </div>
                    <div className="draft-sheet__actions">
                      <button
                        className="ghost-button is-compact"
                        type="button"
                        onClick={onCopy}
                        aria-label="Copy cover letter"
                      >
                        <Clipboard size={12} aria-hidden="true" />
                        <span>{coverCopied ? "Copied" : "Copy"}</span>
                      </button>
                    </div>
                  </div>
                  <hr className="draft-sheet__rule" />
                  <textarea
                    className="draft-sheet__textarea draft-sheet__textarea--letter"
                    readOnly
                    aria-label="Copy-ready cover letter"
                    value={coverLetterText}
                  />
                </article>
              ) : null}

              {/* Answer draft sheets */}
              {drafts.map((d, i) => {
                const key = `a-${i}`;
                return (
                  <article className="draft-sheet" key={key}>
                    <div className="draft-sheet__head">
                      <div className="draft-sheet__meta">
                        <span className="draft-sheet__kind">Question</span>
                        <h3 className="draft-sheet__title">{d.question}</h3>
                      </div>
                      <div className="draft-sheet__actions">
                        {d.needsInput ? (
                          <em className="questions-flag">Needs your input</em>
                        ) : null}
                        <label className="draft-savebox">
                          <input
                            type="checkbox"
                            checked={d.save}
                            onChange={() =>
                              setDrafts((arr) =>
                                arr.map((x, idx) => (idx === i ? { ...x, save: !x.save } : x))
                              )
                            }
                          />
                          <span>Save</span>
                        </label>
                        <button
                          className="ghost-button is-compact"
                          type="button"
                          onClick={() => copy(key, d.answer)}
                          aria-label={`Copy answer to: ${d.question}`}
                        >
                          <Clipboard size={12} aria-hidden="true" />
                          <span>{copiedKey === key ? "Copied" : copyFailedKey === key ? "Copy failed" : "Copy"}</span>
                        </button>
                      </div>
                    </div>
                    <hr className="draft-sheet__rule" />
                    <textarea
                      className="draft-sheet__textarea"
                      value={d.answer}
                      aria-label={`Answer to: ${d.question}`}
                      onChange={(e) =>
                        setDrafts((arr) =>
                          arr.map((x, idx) =>
                            idx === i ? { ...x, answer: e.target.value } : x
                          )
                        )
                      }
                    />
                  </article>
                );
              })}

              {/* Role description sheets */}
              {roleDrafts.map((r, i) => {
                const key = `r-${i}`;
                return (
                  <article className="draft-sheet" key={key}>
                    <div className="draft-sheet__head">
                      <div className="draft-sheet__meta">
                        <span className="draft-sheet__kind">Role note</span>
                        <h3 className="draft-sheet__title">{r.role}</h3>
                      </div>
                      <div className="draft-sheet__actions">
                        {r.needsInput ? (
                          <em className="questions-flag">Needs your input</em>
                        ) : null}
                        <label className="draft-savebox">
                          <input
                            type="checkbox"
                            checked={r.save}
                            onChange={() =>
                              setRoleDrafts((arr) =>
                                arr.map((x, idx) =>
                                  idx === i ? { ...x, save: !x.save } : x
                                )
                              )
                            }
                          />
                          <span>Save</span>
                        </label>
                        <button
                          className="ghost-button is-compact"
                          type="button"
                          onClick={() => copy(key, r.description)}
                          aria-label={`Copy description for ${r.role}`}
                        >
                          <Clipboard size={12} aria-hidden="true" />
                          <span>{copiedKey === key ? "Copied" : copyFailedKey === key ? "Copy failed" : "Copy"}</span>
                        </button>
                      </div>
                    </div>
                    <hr className="draft-sheet__rule" />
                    <textarea
                      className="draft-sheet__textarea"
                      value={r.description}
                      aria-label={`Description for ${r.role}`}
                      onChange={(e) =>
                        setRoleDrafts((arr) =>
                          arr.map((x, idx) =>
                            idx === i ? { ...x, description: e.target.value } : x
                          )
                        )
                      }
                    />
                  </article>
                );
              })}
            </>
          ) : (
            /* Empty state: not a sheet, just calm text on the desk */
            <div className="materials-empty">
              <strong>Nothing drafted yet.</strong>
              <p>
                Pick items in the plan, then generate. The cover letter can be generated on its
                own here, or drafted alongside your next Polish.
              </p>
            </div>
          )}
        </div>

        {/* ---- Right rail: Plan ---- */}
        <aside className="materials-plan" aria-label="Draft plan">
          <p className="materials-plan__eyebrow">Plan</p>

          <div className="plan-list" role="group" aria-label="Items to draft">
            {/* Cover letter row + on-demand generate (no full polish required) */}
            <label className="plan-row">
              <input
                type="checkbox"
                checked={includeCoverLetter}
                onChange={(e) => setIncludeCoverLetter(e.target.checked)}
              />
              <span className="plan-row__label">Cover letter</span>
              {coverBadge === "drafted" ? (
                <span className="plan-row__status plan-row__status--drafted">Drafted</span>
              ) : coverBadge === "pending" ? (
                <span className="plan-row__status plan-row__status--pending">With next polish</span>
              ) : null}
            </label>
            <div className="plan-cover-actions">
              <button
                className="secondary-button is-compact"
                type="button"
                onClick={onGenerateCoverLetter}
                disabled={!canGenerate || isGeneratingCover}
                title={!canGenerate ? gateHint : undefined}
              >
                <Sparkles size={12} aria-hidden="true" />
                <span>
                  {isGeneratingCover ? (
                    <>Drafting<span className="loading-dots" aria-hidden="true" /></>
                  ) : hasCoverDraft ? (
                    "Regenerate cover letter"
                  ) : (
                    "Generate cover letter"
                  )}
                </span>
              </button>
            </div>
            {coverStatus ? (
              <p className="plan-row__hint plan-cover-status" aria-live="polite">
                {coverStatus}
              </p>
            ) : null}

            {/* Standard questions */}
            {DEFAULT_QUESTIONS.map((q, i) => (
              <label className="plan-row" key={q}>
                <input
                  type="checkbox"
                  checked={selected[i]}
                  onChange={() =>
                    setSelected((s) => s.map((v, idx) => (idx === i ? !v : v)))
                  }
                />
                <span className="plan-row__label">{q}</span>
              </label>
            ))}

            {/* Custom questions */}
            {customs.map((c, i) => (
              <div className="plan-custom-row" key={`${c}-${i}`}>
                <span className="plan-custom-row__text" title={c}>
                  {c}
                </span>
                <button
                  className="ghost-button is-compact"
                  type="button"
                  aria-label="Remove question"
                  onClick={() => setCustoms((arr) => arr.filter((_, idx) => idx !== i))}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </div>
            ))}

            {/* Add custom question */}
            <div className="plan-add">
              <input
                type="text"
                value={newCustom}
                placeholder="Paste an application question…"
                aria-label="Custom question to add"
                onChange={(e) => setNewCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustom();
                  }
                }}
              />
              <button
                className="secondary-button is-compact"
                type="button"
                onClick={addCustom}
                aria-label="Add question"
              >
                <Plus size={12} aria-hidden="true" />
                <span>Add</span>
              </button>
            </div>

            {/* Role descriptions row */}
            <label className="plan-row" style={{ marginTop: "var(--s2)" }}>
              <input
                type="checkbox"
                checked={includeRoles}
                onChange={() => setIncludeRoles((v) => !v)}
              />
              <span className="plan-row__label">Role descriptions</span>
            </label>
            <p className="plan-row__hint">One per work experience</p>
          </div>

          <hr className="plan-divider" />

          <button
            className="primary-button is-compact plan-generate"
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate || isGeneratingAnswers || nothingChosen}
            title={!canGenerate ? gateHint : nothingChosen ? "Pick at least one question or Role descriptions to draft." : undefined}
          >
            <Sparkles size={12} aria-hidden="true" />
            <span>{isGeneratingAnswers ? <>Drafting<span className="loading-dots" aria-hidden="true" /></> : "Generate drafts"}</span>
          </button>

          <p className="plan-status" aria-live="polite">
            {gateHint ||
              answersStatus ||
              (canGenerate && !hasAnswerDrafts
                ? "Drafts appear here after generating."
                : "")}
          </p>
        </aside>
      </div>
    </section>
  );
}
