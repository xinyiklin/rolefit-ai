import { createHash } from "node:crypto";
import { splitProfileEvidence } from "../../src/lib/coverLetterEvidence.ts";
import {
  ANSWER_QUESTION_MAX_CHARS, ANSWER_TEXT_MAX_CHARS, ANSWER_REFINEMENT_MAX_CHARS,
  extractAnswerConstraints, hasUnresolvedAnswerPlaceholder, normalizeAnswerText, validateAnswerConstraints,
  type ApplicationAnswerRevision
} from "../../shared/applicationAnswersContract.ts";
import { candidateContextLimitError } from "../../shared/candidateProfileContract.ts";
import { hasMarkupTag, sanitizeContentWarnings } from "../../shared/contentWarnings.ts";
import { candidateClaimIssue } from "./claimEvidence.ts";
import { callConfiguredProvider } from "./clients.ts";
import { UserSafeAiError } from "./errors.ts";
import { findUngroundedCuratedClaimTerm, findUngroundedOutcomeClaim, findUngroundedProseProperClaimTerm, proseHasUngroundedTerm } from "./grounding.ts";
import { ANSWER_CONVERSATION_FENCE_NAMES, fenceUntrusted, inputFirewallRule } from "./prompts.ts";
import { resolveProviderRequest } from "./providers.ts";
import { recordProviderUsage, type UsageSink } from "./providerUsage.ts";
import { hasUngroundedNumericClaim } from "./sanitize.ts";

export const APPLICATION_ANSWER_PROMPT_VERSION = "application-answer-conversation-v4";
const INVALID_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
type AnswerRequest = {
  applicationId: string;
  answerRevisionId: string;
  question: { id: string; revision: number; text: string };
  resumeText: string;
  jobText: string;
  rawJobText: string;
  candidateContext: string;
  explicitFacts: string[];
  clarification: string;
  refinement: string;
  previousAnswer?: { id: string; text: string };
  customInstructions: string;
  sourceWarnings: string[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function boundedText(value: unknown, label: string, limit: number, required = false): string {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || (required && !value.trim()) || INVALID_CONTROL.test(value)) {
    throw new UserSafeAiError(`${label} must be valid text.`, 400);
  }
  if (value.length > limit) throw new UserSafeAiError(`${label} exceeds the ${limit.toLocaleString("en-US")}-character limit. Shorten it before sending.`, 400);
  return value;
}
function identity(value: unknown, label: string): string {
  const text = boundedText(value, label, 120, true);
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new UserSafeAiError(`${label} is invalid. Start a new question and try again.`, 400);
  return text;
}

export function parseApplicationAnswerRequest(body: Record<string, unknown>): AnswerRequest {
  const question = record(body.question);
  if (!Number.isSafeInteger(question.revision) || Number(question.revision) < 1) throw new UserSafeAiError("Question revision is invalid.", 400);
  const candidateContext = boundedText(body.candidateContext, "Profile", 26_000);
  const profileError = candidateContextLimitError(candidateContext);
  if (profileError) throw new UserSafeAiError(profileError, 400);
  if (body.explicitFacts !== undefined && (!Array.isArray(body.explicitFacts) || body.explicitFacts.length > 20)) throw new UserSafeAiError("Supply no more than 20 explicit facts.", 400);
  const explicitFacts = (Array.isArray(body.explicitFacts) ? body.explicitFacts : []).map((fact) => boundedText(fact, "Explicit fact", ANSWER_REFINEMENT_MAX_CHARS, true));
  if (explicitFacts.join("\n").length > 12_000) throw new UserSafeAiError("Explicit facts exceed the 12,000-character limit.", 400);
  const previous = body.previousAnswer === undefined ? undefined : record(body.previousAnswer);
  const result: AnswerRequest = {
    applicationId: identity(body.applicationId, "Application identity"),
    answerRevisionId: identity(body.answerRevisionId, "Answer identity"),
    question: { id: identity(question.id, "Question identity"), revision: Number(question.revision), text: boundedText(question.text, "Question", ANSWER_QUESTION_MAX_CHARS, true) },
    resumeText: boundedText(body.resumeText, "Resume", 45_000, true),
    jobText: boundedText(body.jobText, "Prepared job", 35_000, true),
    rawJobText: boundedText(body.rawJobText, "Original posting", 60_000),
    candidateContext, explicitFacts,
    clarification: boundedText(body.clarification, "Clarification", ANSWER_REFINEMENT_MAX_CHARS),
    refinement: boundedText(body.refinement, "Refinement", ANSWER_REFINEMENT_MAX_CHARS),
    ...(previous ? { previousAnswer: { id: identity(previous.id, "Previous answer identity"), text: boundedText(previous.text, "Previous answer", ANSWER_TEXT_MAX_CHARS) } } : {}),
    customInstructions: boundedText(body.customInstructions, "Custom instructions", 4_000),
    sourceWarnings: sanitizeContentWarnings(body.sourceWarnings) ?? []
  };
  if (extractAnswerConstraints(result.question.text).length > 40) throw new UserSafeAiError("This question contains too many length constraints. Send one employer field at a time.", 400);
  if (result.refinement && !result.previousAnswer) throw new UserSafeAiError("Select an answer before requesting a refinement.", 400);
  return result;
}

export function buildApplicationAnswerPrompts(input: AnswerRequest): { systemPrompt: string; userPrompt: string } {
  const constraints = extractAnswerConstraints(input.question.text);
  const section = (name: (typeof ANSWER_CONVERSATION_FENCE_NAMES)[number], text: string) => `<${name}>\n${fenceUntrusted(text || "None provided.")}\n</${name}>`;
  return {
    systemPrompt: `Write the applicant's answer to the exact application question using supplied context. Return strict JSON only.
${inputFirewallRule(ANSWER_CONVERSATION_FENCE_NAMES)}
Start with the answer or strongest relevant point. Use natural first-person language, clear active verbs, contractions when natural, and a few specific details. Every sentence must be useful. Distinguish company motivation, role motivation, fit, behavioral examples and factual fields; cover every requested part.
Use candidate facts only from the selected resume, whole Profile, explicit user facts and clarification. Preserve employment versus study versus personal project versus aspiration, individual contributions versus team outcomes, and supporting versus leading responsibility. Match the question's requested setting: a personal project cannot answer 'at work' unless the question permits it. A modest documented contribution is enough; do not demand impressive impact or metrics. Never invent metrics, credentials, eligibility, employer facts, product usage, personal motivation, anecdotes or history, including what the applicant previously assumed, intended or felt. Employer context does not prove candidate experience. Previous/generated/saved answers and editing instructions are not independent evidence. Unresolved bracketed source slots are instructions, not facts.
For an ordinary motivation question, propose a modest professional connection between documented experience and the supplied work. Do not demand a personal story unnecessarily. If a necessary personal fact or real behavioral story is missing, return an empty answer and one short, direct question in clarification asking only for that missing fact or example. Do not suggest outcomes, metrics or alternative stories for the applicant to adopt. Do not insert placeholders or questions into answer text. Advisory uncertainty about otherwise usable prose belongs in warnings and must not block the answer.
Use only the detail needed to answer the question; a short paragraph or a few sentences can be complete. Factual fields need only the requested fact. Detailed supporting statements follow employer scope. Hard employer constraints override style preferences and refinement requests. A maximum is a ceiling: do not pad a complete answer.
For behavioral examples, briefly state the situation, focus on the applicant's action, and give the supported result or requested learning. Do not append an unasked personal lesson, change in values or closing pitch for the job. Preserve scope with accurate wording such as 'helped' or 'personal project', not unnecessary disclaimers about what the applicant did not do. Avoid generic praise, exaggerated enthusiasm, jargon, keyword lists, repeated conclusions, greetings, headings and commentary unless requested. Return finished plain prose.
When refining, make the smallest useful edit. Keep supported specifics, voice and responsibility level; add or remove content only to satisfy the question or requested change, correct an unsupported claim, or meet a hard limit. Do not merge separate experiences into one story or broaden a specific fact into expertise. Good wording may stay unchanged. A typo correction should not rewrite a paragraph. Before returning check factual scope, contradictions, repetition, coverage and all length constraints.`,
    userPrompt: `Return {"questionId":${JSON.stringify(input.question.id)},"questionRevision":${input.question.revision},"answer":"finished plain answer, or empty if a necessary fact is missing","clarification":"one necessary follow-up, otherwise empty","warnings":[]}.
Copy questionId and questionRevision exactly. Answer all parts of this one employer field; 'total' is one shared budget and 'each answer' applies to this field independently.
${section("original_employer_question", input.question.text)}
${section("detected_constraints", JSON.stringify(constraints))}
${section("prepared_job_priorities_employer_context", input.jobText)}
${section("original_posting_employer_context", input.rawJobText)}
${section("selected_resume_candidate_evidence", input.resumeText)}
${section("whole_profile_candidate_evidence", splitProfileEvidence(input.candidateContext).join("\n"))}
${section("explicit_user_facts_candidate_evidence", input.explicitFacts.flatMap(splitProfileEvidence).join("\n"))}
${section("user_clarification_candidate_evidence", splitProfileEvidence(input.clarification).join("\n"))}
${section("previous_answer_for_editing_not_evidence", input.previousAnswer?.text ?? "")}
${section("refinement_instruction_not_evidence", input.refinement)}
${section("style_preferences_never_override_truth_or_employer_limits", input.customInstructions)}
${section("source_concerns_advisory_not_evidence", input.sourceWarnings.join("\n"))}`
  };
}

type ParsedDraft = { answer: string; clarification: string; warnings: string[] };
function readDraft(raw: unknown, input: AnswerRequest): ParsedDraft {
  const value = record(raw);
  if (value.questionId !== input.question.id || value.questionRevision !== input.question.revision) throw new UserSafeAiError("The response did not match this question. Try again.", 502);
  const answer = typeof value.answer === "string" ? normalizeAnswerText(value.answer).trim() : "";
  const clarification = typeof value.clarification === "string" ? normalizeAnswerText(value.clarification).trim() : "";
  if ((!answer && !clarification) || answer.length > ANSWER_TEXT_MAX_CHARS || clarification.length > 2_000 || hasMarkupTag(answer) || hasMarkupTag(clarification) || INVALID_CONTROL.test(answer + clarification)) {
    throw new UserSafeAiError("The AI response did not include usable answer text. Try again or switch models.", 502);
  }
  if (answer && clarification) throw new UserSafeAiError("The AI response mixed an answer and a follow-up. Try again.", 502);
  return { answer, clarification, warnings: sanitizeContentWarnings(value.warnings) ?? [] };
}

function evidenceWarnings(answer: string, input: AnswerRequest): string[] {
  if (!answer) return [];
  const evidence = [input.resumeText, ...[input.candidateContext, ...input.explicitFacts, input.clarification].flatMap(splitProfileEvidence)].join("\n");
  const job = `${input.jobText}\n${input.rawJobText}`;
  const issue = candidateClaimIssue(answer, evidence, evidence);
  const unsupported = issue || proseHasUngroundedTerm(answer, job.toLowerCase(), evidence.toLowerCase())
    || hasUngroundedNumericClaim(answer, evidence) || findUngroundedCuratedClaimTerm(answer, evidence)
    || findUngroundedProseProperClaimTerm(answer, evidence, job) || findUngroundedOutcomeClaim(answer, evidence, { candidateProse: true });
  return unsupported ? [`Not supported by provided evidence. ${issue ?? "Check the claims, tools, numbers, and outcomes in this answer."}`] : [];
}
const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");

export async function generateApplicationAnswer(
  body: Record<string, unknown>,
  options: { signal?: AbortSignal; dispatch?: typeof callConfiguredProvider; stats?: { attempts?: number } & UsageSink } = {}
): Promise<ApplicationAnswerRevision> {
  const input = parseApplicationAnswerRequest(body);
  const config = resolveProviderRequest(body);
  const prompts = buildApplicationAnswerPrompts(input);
  const constraints = extractAnswerConstraints(input.question.text);
  const stats = options.stats ?? {};
  const dispatch = options.dispatch ?? callConfiguredProvider;
  const args = { ...config, ...prompts, signal: options.signal, retryUnreadableOutput: false };
  const send = async (request: Parameters<typeof callConfiguredProvider>[0]): Promise<unknown> => {
    const attemptStats: { attempts?: number } & UsageSink = {};
    try {
      return await dispatch(request, attemptStats);
    } finally {
      stats.attempts = (stats.attempts ?? 0) + (attemptStats.attempts ?? 1);
      recordProviderUsage(stats, attemptStats.usage ?? null);
    }
  };
  let draft = readDraft(await send(args), input);
  let validation = validateAnswerConstraints(draft.answer, constraints);
  let repairs = 0;
  if (draft.answer && !constraints.some((constraint) => constraint.unresolvedScope) && (!validation.compliant || hasUnresolvedAnswerPlaceholder(draft.answer))) {
    repairs = 1;
    try {
      const repaired = readDraft(await send({ ...args, userPrompt: `${prompts.userPrompt}\n\nMake one targeted formatting repair to the draft below. Preserve factual meaning and requested parts; do not mechanically truncate or add claims. Remove unfinished placeholders; if the missing fact is necessary, ask one follow-up separately. Return the same JSON shape.\n${fenceUntrusted(JSON.stringify({ draft: draft.answer, counts: validation.counts, violations: validation.violations }))}` }), input);
      // A repair that asks a question instead keeps the draft text for editing.
      draft = repaired.answer ? repaired : { answer: draft.answer, clarification: repaired.clarification, warnings: [...draft.warnings, ...repaired.warnings] };
      validation = validateAnswerConstraints(draft.answer, constraints);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      draft.warnings.push("The formatting repair did not finish. Your original draft is retained; edit it before copying or saving.");
    }
  }
  const incomplete = hasUnresolvedAnswerPlaceholder(draft.answer);
  const warnings = sanitizeContentWarnings([...evidenceWarnings(draft.answer, input), ...input.sourceWarnings, ...draft.warnings, ...(incomplete ? ["This draft still contains a placeholder. Replace it before copying or saving."] : [])]);
  return {
    id: input.answerRevisionId, applicationId: input.applicationId,
    questionId: input.question.id, questionRevision: input.question.revision, question: input.question.text,
    answer: draft.answer, ...(draft.clarification ? { clarification: draft.clarification } : {}),
    status: draft.clarification ? "needs-input" : validation.compliant && !incomplete ? "ready" : "draft",
    constraints, counts: validation.counts, compliant: validation.compliant,
    ...(warnings?.length ? { warnings } : {}),
    ...(input.previousAnswer ? { previousAnswerId: input.previousAnswer.id } : {}),
    ...(input.refinement ? { refinement: input.refinement } : {}),
    generation: { provider: config.provider, model: config.model, reasoningEffort: config.reasoningEffort, createdAt: new Date().toISOString(), attempts: stats.attempts ?? 1 + repairs, promptVersion: APPLICATION_ANSWER_PROMPT_VERSION },
    sources: { resumeFingerprint: fingerprint(input.resumeText), profileFingerprint: fingerprint(input.candidateContext), jobFingerprint: fingerprint(input.jobText), rawJobFingerprint: fingerprint(input.rawJobText), factsFingerprint: fingerprint(JSON.stringify([input.explicitFacts, input.clarification])) }
  };
}
