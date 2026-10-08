import { useEffect, useRef, useState } from "react";
import {
  ANSWER_FACTS_MAX, ANSWER_FACTS_MAX_CHARS, ANSWER_QUESTION_MAX_CHARS, ANSWER_REFINEMENT_MAX_CHARS, ANSWER_TEXT_MAX_CHARS,
  extractAnswerConstraints, hasUnresolvedAnswerPlaceholder, normalizeAnswerText,
  validateAnswerConstraints, type ApplicationAnswerRevision
} from "../../shared/applicationAnswersContract.ts";
import { parseApplicationAnswerRevision } from "../../shared/applicationAnswerStorage.ts";
import { buildStageRequestFields, type StageConfig } from "../lib/aiRequest";
import { classifyFailure, ApiError } from "../lib/failures";
import { workflowInputFingerprint, type AiStageState } from "../lib/aiWorkflow";
import type { ApplicationAnswer } from "./useApplications";

export type AnswerQuestion = { id: string; revision: number; text: string };
export type AnswerMessage = {
  id: string;
  question: AnswerQuestion;
  instruction?: string;
  facts: string[];
  response?: ApplicationAnswerRevision;
  edited?: boolean;
  savedRevisionId?: string;
  savingRevisionId?: string;
  saveError?: string;
};
type Conversation = {
  messages: AnswerMessage[];
  composer: string;
  targetMessageId: string | null;
  editedQuestion: AnswerQuestion | null;
  composerMode: "refinement" | "clarification";
  targetIntent: number;
  status: string;
  progress: AiStageState;
};
type SubmittedTurn = {
  conversationId: string;
  messageId: string;
  applicationId: string;
  question: AnswerQuestion;
  answerRevisionId: string;
  previousAnswer?: { id: string; text: string };
  refinement?: string;
  clarification?: string;
  explicitFacts: string[];
  targetIntent: number;
};
type UseApplicationAnswersArgs = {
  conversationId: string;
  applicationId?: string;
  resumeText: string;
  jobDescription: string;
  rawJobText?: string;
  jobUrl: string;
  candidateContext: string;
  profileLimitMessage: string | null;
  sourceWarnings?: string[];
  customInstructions: string;
  aiRequest: StageConfig;
  providerReady: boolean;
  providerMessage: string;
  savedAnswers: ApplicationAnswer[];
  onSaveAnswer: (answer: ApplicationAnswerRevision, conversationId: string, preserveDraft: boolean) => Promise<{ id: string }>;
  saveBlocker?: string;
};
// One idle object, so an untouched conversation keeps a stable progress identity across renders.
const IDLE_PROGRESS: AiStageState = { status: "idle" };
const emptyConversation = (): Conversation => ({ messages: [], composer: "", targetMessageId: null, editedQuestion: null, composerMode: "refinement", targetIntent: 0, status: "", progress: IDLE_PROGRESS });

export function useApplicationAnswers(args: UseApplicationAnswersArgs) {
  const { conversationId, applicationId, savedAnswers, onSaveAnswer } = args;
  const [conversations, setConversations] = useState<Record<string, Conversation>>({});
  const conversationsRef = useRef(conversations);
  const requestRef = useRef<{ turn: SubmittedTurn; controller: AbortController; fingerprint: string } | null>(null);
  const lastRequestRef = useRef<Record<string, SubmittedTurn>>({});
  const saveRequests = useRef(new Set<string>());
  const currentIdentityRef = useRef(conversationId);
  currentIdentityRef.current = conversationId;
  const fingerprint = workflowInputFingerprint({
    resumeText: args.resumeText, jobDescription: args.jobDescription, rawJobText: args.rawJobText,
    jobUrl: args.jobUrl, candidateContext: args.candidateContext, customInstructions: args.customInstructions,
    sourceWarnings: args.sourceWarnings
  });
  const fingerprintRef = useRef(fingerprint);
  fingerprintRef.current = fingerprint;
  const previousInputs = useRef({ conversationId, fingerprint });
  const conversation = conversations[conversationId] ?? emptyConversation();

  function update(id: string, change: (current: Conversation) => Conversation) {
    const next = { ...conversationsRef.current, [id]: change(conversationsRef.current[id] ?? emptyConversation()) };
    conversationsRef.current = next;
    setConversations(next);
  }
  function updateMessage(id: string, messageId: string, change: (message: AnswerMessage) => AnswerMessage) {
    update(id, (current) => ({ ...current, messages: current.messages.map((message) => message.id === messageId ? change(message) : message) }));
  }
  function stopAnswers(reason = "Answer drafting stopped. Your conversation was kept.") {
    const active = requestRef.current;
    if (!active) return;
    active.controller.abort();
    requestRef.current = null;
    update(active.turn.conversationId, (current) => ({ ...current, status: reason,
      progress: { status: "stopped", errorHeadline: "Stopped", error: reason } }));
  }
  useEffect(() => {
    const prior = previousInputs.current;
    previousInputs.current = { conversationId, fingerprint };
    if (prior.conversationId === conversationId && prior.fingerprint === fingerprint) return;
    stopAnswers("Application or source context changed. The in-flight answer was stopped; existing drafts were kept.");
    if (prior.conversationId === conversationId) update(conversationId, (current) => current.messages.length ? {
      ...current, status: "Source context changed. Earlier answers are preserved; review them against the current resume and job."
    } : current);
  }, [conversationId, fingerprint]);
  useEffect(() => () => { requestRef.current?.controller.abort(); requestRef.current = null; }, []);

  async function generate(turn: SubmittedTurn) {
    if (requestRef.current || turn.conversationId !== currentIdentityRef.current) return;
    const blocker = args.profileLimitMessage || (!args.providerReady ? args.providerMessage : "")
      || (!args.resumeText.trim() ? "Add your resume first." : "")
      || (!args.jobDescription.trim() ? "Add the job on Prepare first." : "");
    lastRequestRef.current[turn.conversationId] = turn;
    if (blocker) {
      update(conversationId, (current) => ({ ...current, status: blocker, progress: { status: "failed", errorHeadline: "Cannot draft yet", error: blocker } }));
      return;
    }
    const controller = new AbortController();
    const request = { turn, controller, fingerprint: fingerprintRef.current };
    requestRef.current = request;
    const isCurrent = () => requestRef.current === request && !controller.signal.aborted
      && currentIdentityRef.current === turn.conversationId && fingerprintRef.current === request.fingerprint;
    update(turn.conversationId, (current) => ({ ...current, status: "Drafting your answer…", progress: { status: "running" } }));
    try {
      const response = await fetch("/api/application-answers", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ ...buildStageRequestFields(args.aiRequest), mode: "conversation",
          applicationId: turn.applicationId, question: turn.question, answerRevisionId: turn.answerRevisionId,
          previousAnswer: turn.previousAnswer, refinement: turn.refinement, clarification: turn.clarification, explicitFacts: turn.explicitFacts,
          resumeText: args.resumeText, jobText: args.jobDescription, rawJobText: args.rawJobText,
          candidateContext: args.candidateContext, customInstructions: args.customInstructions, sourceWarnings: args.sourceWarnings })
      });
      const data = await response.json();
      if (!isCurrent()) return;
      if (!response.ok) throw new ApiError(data.error ?? "Could not draft an answer.", response.status);
      const answer = parseApplicationAnswerRevision(data.answer);
      // Saved facts come only from the user, so a generated revision may never carry them.
      if (!answer || !answer.generation || !answer.sources || answer.userFacts !== undefined || answer.id !== turn.answerRevisionId || answer.applicationId !== turn.applicationId
        || answer.questionId !== turn.question.id || answer.questionRevision !== turn.question.revision || answer.question !== turn.question.text) {
        throw new Error("The answer did not match this question. Retry to create a new draft.");
      }
      update(turn.conversationId, (current) => ({ ...current,
        messages: current.messages.map((message) => message.id === turn.messageId ? { ...message, response: answer } : message),
        ...(current.targetIntent === turn.targetIntent && !current.composer ? { targetMessageId: turn.messageId, composerMode: answer.clarification ? "clarification" as const : "refinement" as const } : {}),
        status: answer.clarification || (answer.compliant ? "Answer drafted. Edit, copy, or save it below." : "Draft kept. Adjust the requested format before copying or saving as ready."),
        progress: { status: "done", note: answer.clarification ? "A detail is needed" : "Answer drafted", noteTone: answer.compliant ? "ok" : "warn" }
      }));
    } catch (error) {
      if (!isCurrent()) return;
      const failure = classifyFailure(error);
      update(turn.conversationId, (current) => ({ ...current,
        status: error instanceof Error ? error.message : "Could not draft the answer. Retry when ready.",
        progress: { status: "failed", errorHeadline: failure.headline, error: failure.detail }
      }));
    } finally {
      if (requestRef.current === request) requestRef.current = null;
    }
  }
  function setComposer(composer: string) { update(conversationId, (current) => ({ ...current, composer })); }
  function newQuestion(text = "") { update(conversationId, (current) => ({ ...current, composer: text, targetMessageId: null, editedQuestion: null, composerMode: "refinement", targetIntent: current.targetIntent + 1 })); }
  function refine(messageId: string, instruction = "", mode?: Conversation["composerMode"]) {
    // A follow-up defaults to Add a detail, but an instruction (a chip) edits the text and is never a fact.
    update(conversationId, (current) => ({ ...current, targetMessageId: messageId, editedQuestion: null, composer: instruction, targetIntent: current.targetIntent + 1,
      composerMode: instruction ? "refinement" : mode ?? (current.messages.find((item) => item.id === messageId)?.response?.clarification ? "clarification" : "refinement") }));
  }
  function editQuestion(messageId: string) {
    update(conversationId, (current) => {
      const message = current.messages.find((item) => item.id === messageId);
      return message ? { ...current, targetMessageId: null, composer: message.question.text, targetIntent: current.targetIntent + 1,
        editedQuestion: { ...message.question, revision: Math.max(message.question.revision, ...current.messages.filter((item) => item.question.id === message.question.id).map((item) => item.question.revision), ...savedAnswers.filter((item) => item.questionId === message.question.id).map((item) => item.questionRevision ?? 1)) + 1 } } : current;
    });
  }
  async function send() {
    const current = conversationsRef.current[conversationId] ?? emptyConversation();
    if (requestRef.current || !current.composer.trim()) return;
    const target = current.messages.find((message) => message.id === current.targetMessageId);
    const limit = target ? ANSWER_REFINEMENT_MAX_CHARS : ANSWER_QUESTION_MAX_CHARS;
    if (current.composer.length > limit) {
      update(conversationId, (state) => ({ ...state, status: `Keep ${target ? "the refinement" : "the question"} within ${limit.toLocaleString()} characters. Your text has been kept.` }));
      return;
    }
    const explicitFacts = [...(target?.facts ?? []), ...(target && current.composerMode === "clarification" ? [current.composer] : [])];
    if (explicitFacts.length > ANSWER_FACTS_MAX || explicitFacts.join("\n").length > ANSWER_FACTS_MAX_CHARS) {
      update(conversationId, (state) => ({ ...state, status: "This question has reached its context limit. Move the supporting facts into Profile before starting a new question. Your message has been kept." }));
      return;
    }
    const question = target?.question ?? { id: current.editedQuestion?.id ?? crypto.randomUUID(), revision: current.editedQuestion?.revision ?? 1, text: current.composer };
    const messageId = crypto.randomUUID();
    const turn: SubmittedTurn = { conversationId, messageId, applicationId: applicationId ?? conversationId,
      question, answerRevisionId: crypto.randomUUID(), targetIntent: current.targetIntent, explicitFacts,
      ...(target?.response ? { previousAnswer: { id: target.response.id, text: target.response.answer },
        ...(current.composerMode === "clarification" ? { clarification: current.composer } : { refinement: current.composer }) } : {}) };
    update(conversationId, (state) => ({ ...state, composer: "", editedQuestion: null,
      messages: [...state.messages, { id: messageId, question, facts: turn.explicitFacts, ...(target ? { instruction: current.composer } : {}) }] }));
    await generate(turn);
  }
  function editAnswer(messageId: string, text: string) {
    if (text.length > ANSWER_TEXT_MAX_CHARS) {
      update(conversationId, (current) => ({ ...current, status: `Answers can contain up to ${ANSWER_TEXT_MAX_CHARS.toLocaleString()} characters. The last edit was not applied.` }));
      return;
    }
    updateMessage(conversationId, messageId, (message) => {
      if (!message.response) return message;
      const validation = validateAnswerConstraints(text, message.response.constraints);
      // Unsaved intermediate edits collapse onto the last saved (or saving) revision.
      const settled = message.savedRevisionId === message.response.id || message.savingRevisionId === message.response.id;
      return { ...message, edited: true, saveError: undefined,
        response: { ...message.response, id: crypto.randomUUID(), previousAnswerId: message.edited && !settled ? message.response.previousAnswerId : message.response.id, generation: undefined, sources: undefined, clarification: undefined,
          answer: text.replace(/\r\n?/g, "\n"), counts: validation.counts, compliant: validation.compliant,
          status: text.trim() && validation.compliant && !hasUnresolvedAnswerPlaceholder(text) ? "ready" : "draft" } };
    });
  }
  async function save(messageId: string, preserveDraft = false) {
    const message = conversationsRef.current[conversationId]?.messages.find((item) => item.id === messageId);
    if (!message?.response || !message.response.answer.trim()) return;
    const response = message.response;
    if (saveRequests.current.has(response.id) || message.savedRevisionId === response.id) return;
    const text = normalizeAnswerText(response.answer);
    const validation = validateAnswerConstraints(text, response.constraints);
    if (!validation.compliant && !preserveDraft) return;
    const saveAsDraft = preserveDraft || response.status !== "ready";
    // Generated and reopened revisions anchor lineage even when unsaved; only a
    // failed manual edit should drop out of the chain.
    const failedEditCollapses = Boolean(message.edited);
    // The question's facts are the user's Add a detail text; answer text never joins them.
    const captured = { ...response, ...(message.facts.length ? { userFacts: { provenance: "user-declared" as const, facts: [...message.facts] } } : {}),
      answer: text, counts: validation.counts, compliant: validation.compliant, status: saveAsDraft ? "draft" as const : "ready" as const };
    saveRequests.current.add(response.id);
    updateMessage(conversationId, messageId, (item) => ({ ...item, savingRevisionId: response.id, saveError: undefined }));
    try {
      await onSaveAnswer(captured, conversationId, saveAsDraft);
      updateMessage(conversationId, messageId, (item) => ({ ...item, savedRevisionId: response.id, savingRevisionId: undefined }));
    } catch (error) {
      // An edit typed during the failed save named this revision as saved; point it past the unsaved one.
      updateMessage(conversationId, messageId, (item) => ({ ...item, savingRevisionId: undefined,
        saveError: error instanceof Error ? error.message : "Could not save the answer. Your draft is still here; try again.",
        response: failedEditCollapses && item.response && item.response.id !== response.id && item.response.previousAnswerId === response.id
          ? { ...item.response, previousAnswerId: response.previousAnswerId } : item.response }));
    } finally { saveRequests.current.delete(response.id); }
  }
  function reopen(answer: ApplicationAnswer) {
    const existing = conversationsRef.current[conversationId]?.messages.find((item) => answer.id && item.response?.id === answer.id);
    if (existing) { refine(existing.id); return; }
    // Limits come from the current rules, so a later edit carries a valid receipt.
    const constraints = extractAnswerConstraints(answer.question);
    const validation = validateAnswerConstraints(answer.answer, constraints);
    const id = answer.id ?? crypto.randomUUID();
    const question = { id: answer.questionId ?? crypto.randomUUID(), revision: answer.questionRevision ?? 1, text: answer.question };
    const { savedAt: _savedAt, userFacts, ...savedRevision } = answer;
    const response: ApplicationAnswerRevision = { ...savedRevision, id, applicationId: answer.applicationId ?? applicationId ?? conversationId,
      questionId: question.id, questionRevision: question.revision, constraints, counts: validation.counts, compliant: validation.compliant,
      status: answer.status ?? (validation.compliant ? "ready" : "draft") };
    const messageId = crypto.randomUUID();
    update(conversationId, (current) => ({ ...current, targetMessageId: messageId, editedQuestion: null, composer: "", composerMode: response.clarification ? "clarification" : "refinement", targetIntent: current.targetIntent + 1,
      messages: [...current.messages, { id: messageId, question, facts: [...(userFacts?.facts ?? [])], response, savedRevisionId: id }] }));
  }
  return {
    conversationId, conversation, savedAnswers, stageConfig: args.aiRequest,
    saveBlocker: args.saveBlocker, isSavePending: () => saveRequests.current.size > 0,
    providerReady: args.providerReady, providerMessage: args.providerMessage, profileLimitMessage: args.profileLimitMessage,
    setComposer, newQuestion, refine, editQuestion, editAnswer, send, save, reopen,
    setComposerMode: (composerMode: Conversation["composerMode"]) => update(conversationId, (current) => ({ ...current, composerMode })),
    isGeneratingAnswers: conversation.progress.status === "running",
    isSavingAnswers: Object.values(conversations).some((current) => current.messages.some((message) => Boolean(message.savingRevisionId))),
    // Only the current thread can still be saved; earlier preparations' threads are unreachable.
    hasUnsavedAnswers: Boolean(conversation.composer.trim()) || conversation.messages.some((message) => Boolean(message.response?.answer.trim()) && message.savedRevisionId !== message.response?.id),
    answersStatus: conversation.status, answersProgress: conversation.progress,
    stopAnswers: () => stopAnswers(),
    retryAnswers: () => { const turn = lastRequestRef.current[conversationId]; if (turn) void generate(turn); }
  };
}
export type ApplicationAnswersController = ReturnType<typeof useApplicationAnswers>;
