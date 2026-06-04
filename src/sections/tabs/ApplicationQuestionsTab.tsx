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
type RoleDraft = { role: string; description: string; save: boolean };

type ApplicationQuestionsTabProps = {
  result: ApplicationAnswersResult;
  status: string;
  isGenerating: boolean;
  canGenerate: boolean;
  canSave: boolean;
  onGenerate: (opts: { questions: string[]; includeRoleDescriptions: boolean }) => void;
  onSaveAnswers: (items: { question: string; answer: string }[]) => void;
};

export function ApplicationQuestionsTab({
  result,
  status,
  isGenerating,
  canGenerate,
  canSave,
  onGenerate,
  onSaveAnswers
}: ApplicationQuestionsTabProps) {
  const [selected, setSelected] = useState<boolean[]>(() => DEFAULT_QUESTIONS.map(() => true));
  const [customs, setCustoms] = useState<string[]>([]);
  const [newCustom, setNewCustom] = useState("");
  const [includeRoles, setIncludeRoles] = useState(true);

  const [drafts, setDrafts] = useState<AnswerDraft[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<RoleDraft[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Reset editable drafts whenever a fresh generation arrives.
  useEffect(() => {
    setDrafts((result?.answers ?? []).map((a) => ({ ...a, save: false })));
    setRoleDrafts((result?.roleDescriptions ?? []).map((r) => ({ ...r, save: false })));
  }, [result]);

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
      // Clipboard API is unavailable (e.g. a non-secure LAN-IP context). Leave
      // the answer text on screen for manual copy rather than crashing the click.
    }
  }

  function handleSave() {
    const items = [
      ...drafts.filter((d) => d.save && d.answer.trim()).map((d) => ({ question: d.question, answer: d.answer.trim() })),
      ...roleDrafts
        .filter((r) => r.save && r.description.trim())
        .map((r) => ({ question: `Role description — ${r.role}`, answer: r.description.trim() }))
    ];
    if (items.length) onSaveAnswers(items);
  }

  const nothingChosen = buildQuestionList().length === 0 && !includeRoles;
  const selectedToSave =
    drafts.filter((d) => d.save).length + roleDrafts.filter((r) => r.save).length;
  const hasResults = drafts.length > 0 || roleDrafts.length > 0;

  return (
    <div className="questions-pane">
      <section className="studio-card studio-card--flush">
        <div className="studio-card__head">
          <h2>Application questions</h2>
          <button
            className="primary-button is-compact"
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate || isGenerating || nothingChosen}
          >
            <Sparkles size={12} aria-hidden="true" />
            <span>{isGenerating ? "Drafting…" : "Generate drafts"}</span>
          </button>
        </div>

        <p className="questions-hint">
          Drafts truthful answers from your resume + the job description. Motivation questions get a
          scaffold with <code>[add: …]</code> placeholders for the parts only you know — fill those in.
        </p>

        <fieldset className="questions-config">
          <legend>Questions to draft</legend>
          {DEFAULT_QUESTIONS.map((q, i) => (
            <label className="questions-check" key={q}>
              <input
                type="checkbox"
                checked={selected[i]}
                onChange={() =>
                  setSelected((s) => s.map((v, idx) => (idx === i ? !v : v)))
                }
              />
              <span>{q}</span>
            </label>
          ))}

          {customs.map((c, i) => (
            <div className="questions-custom-row" key={`${c}-${i}`}>
              <span className="questions-custom-text">{c}</span>
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

          <div className="questions-add">
            <input
              type="text"
              value={newCustom}
              placeholder="Paste the exact question an application asks…"
              onChange={(e) => setNewCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                }
              }}
            />
            <button className="secondary-button is-compact" type="button" onClick={addCustom}>
              <Plus size={12} aria-hidden="true" />
              <span>Add</span>
            </button>
          </div>

          <label className="questions-check questions-check--toggle">
            <input
              type="checkbox"
              checked={includeRoles}
              onChange={() => setIncludeRoles((v) => !v)}
            />
            <span>Also write a description for each work experience</span>
          </label>
        </fieldset>

        {!canGenerate ? (
          <p className="questions-note">Add your resume and the job description first.</p>
        ) : null}
        {status ? <p className="questions-note" aria-live="polite">{status}</p> : null}
      </section>

      {hasResults ? (
        <section className="studio-card studio-card--flush">
          <div className="studio-card__head">
            <h2>Drafts</h2>
            <button
              className="secondary-button is-compact"
              type="button"
              onClick={handleSave}
              disabled={!canSave || selectedToSave === 0}
              title={canSave ? "" : "Track this job in the pipeline first, or add a job link."}
            >
              <span>{selectedToSave ? `Save ${selectedToSave} to pipeline` : "Select to save"}</span>
            </button>
          </div>

          {drafts.map((d, i) => {
            const key = `a-${i}`;
            return (
              <article className="questions-answer" key={key}>
                <header>
                  <h3>{d.question}</h3>
                  <div className="questions-answer__actions">
                    {d.needsInput ? <em className="questions-flag">Needs your input</em> : null}
                    <label className="questions-savebox">
                      <input
                        type="checkbox"
                        checked={d.save}
                        onChange={() =>
                          setDrafts((arr) => arr.map((x, idx) => (idx === i ? { ...x, save: !x.save } : x)))
                        }
                      />
                      <span>Save</span>
                    </label>
                    <button
                      className="ghost-button is-compact"
                      type="button"
                      onClick={() => copy(key, d.answer)}
                    >
                      <Clipboard size={12} aria-hidden="true" />
                      <span>{copiedKey === key ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                </header>
                <textarea
                  className="questions-textarea"
                  value={d.answer}
                  aria-label={`Answer to: ${d.question}`}
                  onChange={(e) =>
                    setDrafts((arr) => arr.map((x, idx) => (idx === i ? { ...x, answer: e.target.value } : x)))
                  }
                />
              </article>
            );
          })}

          {roleDrafts.map((r, i) => {
            const key = `r-${i}`;
            return (
              <article className="questions-answer" key={key}>
                <header>
                  <h3>{r.role}</h3>
                  <div className="questions-answer__actions">
                    <label className="questions-savebox">
                      <input
                        type="checkbox"
                        checked={r.save}
                        onChange={() =>
                          setRoleDrafts((arr) => arr.map((x, idx) => (idx === i ? { ...x, save: !x.save } : x)))
                        }
                      />
                      <span>Save</span>
                    </label>
                    <button
                      className="ghost-button is-compact"
                      type="button"
                      onClick={() => copy(key, r.description)}
                    >
                      <Clipboard size={12} aria-hidden="true" />
                      <span>{copiedKey === key ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                </header>
                <textarea
                  className="questions-textarea"
                  value={r.description}
                  aria-label={`Description for ${r.role}`}
                  onChange={(e) =>
                    setRoleDrafts((arr) => arr.map((x, idx) => (idx === i ? { ...x, description: e.target.value } : x)))
                  }
                />
              </article>
            );
          })}
        </section>
      ) : (
        <section className="studio-card studio-card--flush questions-empty">
          <p>Pick the questions you need, then <strong>Generate drafts</strong>. Answers appear here, editable and copy-ready.</p>
        </section>
      )}
    </div>
  );
}
