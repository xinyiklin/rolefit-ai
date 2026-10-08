import { useEffect, useRef, useState } from "react";
import { Clipboard, MoreHorizontal, Save } from "lucide-react";
import { normalizeAnswerText, validateAnswerConstraints } from "../../../../shared/applicationAnswersContract.ts";
import { ContentWarnings } from "../../../components/ContentWarnings";
import { modelOptionsByProvider, type AiProviderValue } from "../../../config/aiOptions";
import type { AnswerMessage as Message, ApplicationAnswersController } from "../../../hooks/useApplicationAnswers";
import { NavMenu } from "../../NavMenu";

type Props = {
  message: Message;
  index: number;
  controller: ApplicationAnswersController;
  onRefine: (messageId: string, instruction?: string) => void;
  onEditQuestion: (messageId: string) => void;
};

export function AnswerMessage({ message, index, controller, onRefine, onEditQuestion }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const response = message.response;
  // Only a response that lands while this message is on screen animates in; remounts and reopened answers do not.
  const [animateArrival] = useState(() => !response);
  const validation = response ? validateAnswerConstraints(response.answer, response.constraints) : null;
  const nonempty = Boolean(response?.answer.trim());
  const canUse = nonempty && Boolean(validation?.compliant);
  const saved = Boolean(response && message.savedRevisionId === response.id);
  const saving = Boolean(message.savingRevisionId);
  const saveDraft = !canUse || response?.status !== "ready";
  const modelLabel = response?.generation
    ? modelOptionsByProvider[response.generation.provider as AiProviderValue]?.find((model) => model.value === response.generation?.model)?.label ?? "Generated answer"
    : message.edited ? "Your edit" : "Saved answer";

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    let lastWidth = textarea.clientWidth;
    const fit = () => {
      if (!textarea.clientWidth) return;
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight + 2}px`;
    };
    fit();
    const observer = new ResizeObserver(() => {
      const width = textarea.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      fit();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [response?.answer]);
  useEffect(() => { setCopyStatus(""); }, [response?.answer]);

  async function copy() {
    if (!response || !canUse) return;
    try {
      await navigator.clipboard.writeText(normalizeAnswerText(response.answer));
      setCopyStatus("Copied");
    } catch { setCopyStatus("Copy failed. Select the answer text and copy it manually."); }
  }
  function save() { void controller.save(message.id, saveDraft); }
  const questionLabel = `Application question${message.question.revision > 1 ? ` · revision ${message.question.revision}` : ""}`;
  const question = <>
    <div className="answers-message__question-label">
      <span>{questionLabel}</span>
      <button type="button" className="ghost-button is-compact" onClick={() => onEditQuestion(message.id)}>Edit question</button>
    </div>
    <h3>{message.question.text}</h3>
  </>;

  return (
    <article className="answers-message" aria-label={`Answer ${index + 1}`}
      onContextMenu={(event) => { if (response) { event.preventDefault(); setMenuOpen(true); } }}
      onKeyDown={(event) => {
        if (response && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
          event.preventDefault(); setMenuOpen(true);
        }
      }}>
      {message.instruction ? <>
        <details className="answers-message__original-question">
          <summary>Original question{message.question.revision > 1 ? ` · revision ${message.question.revision}` : ""}</summary>
          {question}
        </details>
        <p className="answers-message__instruction">{message.instruction}</p>
      </> : <div className="answers-message__question">
        {question}
        {/* Only a reopened saved answer has facts without an instruction bubble showing them. */}
        {message.facts.length ? (
          <details className="answers-message__facts">
            <summary title="Details you added. Refinements use them as your own statements.">Your facts ({message.facts.length})</summary>
            <ul>{message.facts.map((fact, factIndex) => <li key={factIndex}>{fact}</li>)}</ul>
          </details>
        ) : null}
      </div>}
      {response ? (
        <div className={`answers-message__response${animateArrival ? " is-arriving" : ""}`}>
          {response.answer || message.edited ? (
            <textarea ref={textareaRef} className="answers-message__text" value={response.answer}
              aria-label={`Answer to: ${message.question.text}`} rows={3} spellCheck
              onChange={(event) => controller.editAnswer(message.id, event.target.value)} />
          ) : null}
          {response.clarification ? (
            <p className="answers-message__clarification"><strong>A detail from you</strong>{response.clarification}</p>
          ) : null}
          {validation && nonempty ? (
            <div className="answers-message__counts">
              <span>{validation.counts.words} words · {validation.counts.characters} characters{response.constraints.some((constraint) => constraint.unit === "sentences") ? ` · ${validation.counts.sentences} sentences` : ""}</span>
              <span aria-live="polite">{!validation.compliant ? <span className="answers-message__fit is-off">Format needs attention</span>
                : response.constraints.some((constraint) => constraint.hard) ? <span className="answers-message__fit">Within limits</span> : null}</span>
            </div>
          ) : null}
          {validation?.violations.length ? <ul className="answers-message__limits">{validation.violations.map((violation) => <li key={violation}>{violation}</li>)}</ul> : null}
          {message.edited && response.warnings?.length ? <p className="answers-note">Warnings refer to the generated wording before your edits.</p> : null}
          <ContentWarnings warnings={response.warnings} />
          <div className="answers-message__actions">
            <button type="button" className="ghost-button is-compact" disabled={!canUse} aria-label="Copy answer" onClick={() => void copy()}>
              <Clipboard size={13} aria-hidden="true" />{copyStatus === "Copied" ? "Copied" : "Copy"}
            </button>
            <button type="button" className="ghost-button is-compact" disabled={!nonempty || saving || saved || Boolean(controller.saveBlocker)} onClick={save}>
              <Save size={13} aria-hidden="true" />{saving ? "Saving…" : saved ? "Saved" : saveDraft ? "Save draft" : "Save answer"}
            </button>
            <NavMenu icon={<MoreHorizontal size={16} aria-hidden="true" />} label={null}
              ariaLabel={`Actions for answer ${index + 1}`} className="answers-message__menu" popoverPlacement="above" open={menuOpen} onOpenChange={setMenuOpen}>
              <button type="button" className="ghost-button" disabled={!canUse} onClick={() => { void copy(); setMenuOpen(false); }}>Copy answer</button>
              <button type="button" className="ghost-button" disabled={!nonempty || saving || saved || Boolean(controller.saveBlocker)} onClick={() => { save(); setMenuOpen(false); }}>
                {saveDraft ? "Save draft to application" : "Save answer to application"}
              </button>
              <button type="button" className="ghost-button" onClick={() => { onRefine(message.id); setMenuOpen(false); }}>Refine this answer</button>
            </NavMenu>
            <span className="answers-message__model" title={response.generation ? `${response.generation.provider} · ${response.generation.model} · ${response.generation.reasoningEffort}` : "Original generation details are unavailable for this wording."}>
              {modelLabel}{response.generation?.reasoningEffort ? ` · ${response.generation.reasoningEffort}` : ""}
            </span>
          </div>
          <div className="answers-message__refinements">
            {nonempty ? ["Shorter", "More natural", "Emphasize this role"].map((instruction) => (
              <button key={instruction} type="button" className="ghost-button is-compact" onClick={() => onRefine(message.id, instruction)}>{instruction}</button>
            )) : <button type="button" className="ghost-button is-compact" onClick={() => onRefine(message.id)}>Add the detail</button>}
          </div>
          {copyStatus && copyStatus !== "Copied" ? <p className="answers-note" role="status">{copyStatus}</p> : null}
          {message.saveError ? <p className="answers-note answers-note--error" role="alert">{message.saveError}</p> : null}
          {controller.saveBlocker ? <p className="answers-note">{controller.saveBlocker}</p> : null}
        </div>
      ) : controller.isGeneratingAnswers && index === controller.conversation.messages.length - 1 ? (
        <p className="answers-pending" aria-hidden="true"><span className="answers-pending__dots"><i /><i /><i /></span>{message.instruction ? "Revising your answer" : "Drafting your answer"}</p>
      ) : <p className="answers-note">No answer yet. Retry drafting when ready.</p>}
    </article>
  );
}
