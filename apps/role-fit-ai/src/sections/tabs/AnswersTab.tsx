import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, BookOpen, FileText, Plus, Square } from "lucide-react";
import { extractAnswerConstraints } from "../../../shared/applicationAnswersContract.ts";
import type { ApplicationAnswersController } from "../../hooks/useApplicationAnswers";
import { NavMenu } from "../NavMenu";
import { AnswerMessage } from "./answers/AnswerMessage";

const STARTERS = ["Why this company?", "Why this role?", "Describe a relevant project."];
const COMPOSER_MODES = [
  { value: "refinement", label: "Refine", title: "Refine the wording" },
  { value: "clarification", label: "Add a detail", title: "Add a fact or missing detail" }
] as const;
export type AnswersTabProps = {
  controller: ApplicationAnswersController;
  resumeReady: boolean;
  jobReady: boolean;
  jobTarget?: { role?: string; company?: string };
  resumeLabel?: string;
  hasProfile?: boolean;
  hasOriginalPosting?: boolean;
  modelPicker: ReactNode;
};

export function AnswersTab({
  controller, resumeReady, jobReady, jobTarget, resumeLabel,
  hasProfile, hasOriginalPosting, modelPicker
}: AnswersTabProps) {
  const { conversation, savedAnswers, isGeneratingAnswers } = controller;
  const [savedOpen, setSavedOpen] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const modeName = useId();
  const atBottomRef = useRef(true);
  const target = conversation.messages.find((message) => message.id === conversation.targetMessageId);
  const constraints = extractAnswerConstraints(target?.question.text ?? conversation.composer);
  const gate = controller.profileLimitMessage || (!resumeReady ? "Add your resume first." : !jobReady ? "Add the job on Prepare first." : !controller.providerReady ? controller.providerMessage : "");
  const targetLine = [jobTarget?.company, jobTarget?.role].filter(Boolean).join(" · ");
  const lastMessage = conversation.messages[conversation.messages.length - 1];
  const latestResponse = lastMessage?.response ? lastMessage.id : undefined;
  const empty = conversation.messages.length === 0;
  const clarifying = Boolean(target) && conversation.composerMode === "clarification";

  useEffect(() => {
    if (atBottomRef.current && scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [conversation.messages.length, latestResponse, isGeneratingAnswers]);
  useLayoutEffect(fitComposer, [conversation.composer, empty]);
  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    let lastWidth = composer.clientWidth;
    const observer = new ResizeObserver(() => {
      if (composer.clientWidth === lastWidth) return;
      lastWidth = composer.clientWidth;
      fitComposer();
    });
    observer.observe(composer);
    return () => observer.disconnect();
  }, []);
  // Collapsing to measure clamps the thread's scrollTop, so restore it (or keep following the bottom).
  function fitComposer() {
    const composer = composerRef.current;
    const scroller = scrollerRef.current;
    if (!composer) return;
    const scrollTop = scroller?.scrollTop ?? 0;
    composer.style.height = "auto";
    composer.style.height = `${composer.scrollHeight}px`;
    if (scroller) scroller.scrollTop = atBottomRef.current ? scroller.scrollHeight : scrollTop;
  }
  function focusComposer() { requestAnimationFrame(() => composerRef.current?.focus()); }
  function refine(id: string, instruction?: string, mode?: "refinement") { controller.refine(id, instruction, mode); focusComposer(); }

  return (
    <section className={`answers-page${empty ? " is-empty" : ""}`} aria-label="Application answers">
      <header className="answers-header">
        <div>
          <h2 className="page-serif">Answers</h2>
          <p>{targetLine || "Your application questions, one at a time."}</p>
        </div>
        <div className="answers-header__controls">
          <NavMenu icon={<FileText size={14} aria-hidden="true" />} label="Context" ariaLabel="Answer context" className="answers-context">
            <dl>
              <dt>Job</dt><dd>{jobReady ? targetLine || "Current job brief" : "Add a job on Prepare"}</dd>
              <dt>Original posting</dt><dd>{hasOriginalPosting ? "Included" : "Not captured"}</dd>
              <dt>Resume</dt><dd>{resumeReady ? resumeLabel || "Current resume, including edits" : "Not added"}</dd>
              <dt>Profile</dt><dd>{hasProfile ? "Included" : "No Profile context supplied"}</dd>
            </dl>
            <p className="answers-note">Answers use your Application Answers guidance. Earlier generated answers are drafts, not verified facts.</p>
          </NavMenu>
          <NavMenu icon={<BookOpen size={14} aria-hidden="true" />} label={`Saved answers${savedAnswers.length ? ` (${savedAnswers.length})` : ""}`}
            ariaLabel="Saved answers" className="answers-saved" open={savedOpen} onOpenChange={setSavedOpen}>
            {savedAnswers.length ? (
              <ol>{savedAnswers.map((answer, index) => (
                <li key={answer.id ?? `${answer.savedAt}-${index}`}>
                  <button type="button" onClick={() => { controller.reopen(answer); setSavedOpen(false); focusComposer(); }}>
                    <strong>{answer.question}</strong>
                    <span>{answer.answer}</span>
                    <small>Version {savedAnswers.slice(0, index + 1).filter((item) => (item.questionId ?? item.question) === (answer.questionId ?? answer.question)).length} · {answer.status === "draft" ? "Draft · " : ""}{answer.savedAt ? new Date(answer.savedAt).toLocaleString() : "Saved answer"}{answer.questionRevision ? ` · question revision ${answer.questionRevision}` : ""}</small>
                  </button>
                </li>
              ))}</ol>
            ) : <p className="answers-note">Save an answer to keep it with this application. Your first save creates a Draft application.</p>}
          </NavMenu>
        </div>
      </header>
      <div className="answers-conversation" ref={scrollerRef} onScroll={(event) => {
        const node = event.currentTarget;
        atBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
      }}>
        {empty ? (
          <div className="answers-empty">
            <h3>What does the application ask?</h3>
            <p>Start with the exact wording, including any word or character limit.</p>
            <div className="answers-starters">{STARTERS.map((question) => (
              <button key={question} type="button" className="secondary-button is-compact" onClick={() => { controller.newQuestion(question); focusComposer(); }}>{question}</button>
            ))}</div>
          </div>
        ) : (
          <div className="answers-thread">{conversation.messages.map((message, index) => (
            <AnswerMessage key={message.id} message={message} index={index} controller={controller} onRefine={refine}
              onEditQuestion={(id) => { controller.editQuestion(id); focusComposer(); }} />
          ))}</div>
        )}
      </div>
      <div className="answers-composer-wrap">
        <form className="answers-composer" onSubmit={(event) => { event.preventDefault(); void controller.send(); }}>
          {target || conversation.editedQuestion ? (
            <div className="answers-composer__target">
              <span title={target?.question.text}>{target ? `Refining: ${target.question.text}` : `Editing question · revision ${conversation.editedQuestion?.revision}`}</span>
              <button type="button" className="ghost-button is-compact" onClick={() => { controller.newQuestion(); focusComposer(); }}>
                <Plus size={12} aria-hidden="true" />New question
              </button>
            </div>
          ) : null}
          <textarea ref={composerRef} rows={2} aria-label={clarifying ? "Missing detail" : target ? "Refinement" : "Application question"}
            value={conversation.composer}
            placeholder={clarifying ? "Add the fact or detail the answer needs…" : target ? "What would you like to change?" : "Paste an application question, including any limits…"}
            onChange={(event) => controller.setComposer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                if (!gate) void controller.send();
              }
            }} />
          <div className="answers-composer__footer">
            {modelPicker}
            {target ? (
              <div className="answers-mode" role="radiogroup" aria-label="Message type"
                onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}>
                {COMPOSER_MODES.map((mode) => (
                  <label key={mode.value} className={conversation.composerMode === mode.value ? "is-active" : undefined} title={mode.title}>
                    <input type="radio" name={modeName} value={mode.value} checked={conversation.composerMode === mode.value}
                      onChange={() => controller.setComposerMode(mode.value)} />
                    {mode.label}
                  </label>
                ))}
              </div>
            ) : null}
            <div className="answers-composer__send">
              {constraints.length ? (
                <div className="answers-composer__constraints" role="group" aria-label="Question limits">
                  {constraints.map((constraint, index) => <span key={`${constraint.source}-${index}`}>{constraint.source}{!constraint.hard ? " · approximate" : ""}</span>)}
                </div>
              ) : null}
              {isGeneratingAnswers ? (
                <button type="button" className="answers-send secondary-button" onClick={controller.stopAnswers} aria-label="Stop drafting" title="Stop drafting">
                  <Square size={14} aria-hidden="true" />
                </button>
              ) : (
                <button type="submit" className="answers-send primary-button" disabled={Boolean(gate) || !conversation.composer.trim()}
                  aria-label={target ? "Refine answer" : "Draft answer"} title={target ? "Refine answer" : "Draft answer"}>
                  <ArrowUp size={18} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </form>
        <div className="answers-status" role="status">
          <span className={isGeneratingAnswers ? "sr-only" : undefined}>{gate || conversation.status || "Draft, refine, then save the answers you want to keep."}</span>
          {conversation.progress.status === "failed" || conversation.progress.status === "stopped" ? (
            <button type="button" className="ghost-button is-compact" onClick={controller.retryAnswers} disabled={Boolean(gate)}>Retry</button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
