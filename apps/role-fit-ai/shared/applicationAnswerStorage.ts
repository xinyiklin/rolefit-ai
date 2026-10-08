import {
  ANSWER_QUESTION_MAX_CHARS,
  ANSWER_REFINEMENT_MAX_CHARS,
  ANSWER_TEXT_MAX_CHARS,
  answerFactsWithinLimits,
  extractAnswerConstraints,
  normalizeAnswerText,
  validateAnswerConstraints,
  type ApplicationAnswerRevision
} from "./applicationAnswersContract.ts";

export const MAX_SAVED_ANSWER_REVISIONS = 160;
export const MAX_SAVED_ANSWERS_CHARS = 512_000;
export type ApplicationAnswer = {
  question: string;
  answer: string;
  savedAt: string;
} & Partial<Omit<ApplicationAnswerRevision, "question" | "answer">>;

const ID = /^[A-Za-z0-9_-]{1,120}$/;
const HASH = /^[a-f0-9]{64}$/;
const REVISION_KEYS = ["id", "applicationId", "originId", "questionId", "questionRevision", "question", "answer", "clarification", "status", "constraints", "counts", "compliant", "warnings", "previousAnswerId", "refinement", "generation", "sources", "userFacts"];
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const boundedText = (value: unknown, max: number, nonempty = true): value is string => typeof value === "string" && value.length <= max && (!nonempty || Boolean(value.trim()));
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key));
const integer = (value: unknown, min = 0, max = 1_000_000): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const optional = (value: unknown, check: (entry: unknown) => boolean) => value === undefined || check(value);

// This parser serves the provider response and tracker boundary. Returning the
// original value preserves exact text and metadata; invalid entries never clip.
// Receipts are checked by shape only, so a later count or limit rule never
// invalidates a stored tracker; `answerReceiptIsCurrent` verifies a new
// revision at save time.
export function parseApplicationAnswerRevision(raw: unknown): ApplicationAnswerRevision | null {
  if (!isObject(raw) || !exactKeys(raw, REVISION_KEYS)) return null;
  if (![raw.id, raw.applicationId, raw.questionId].every((id) => typeof id === "string" && ID.test(id))
    || !optional(raw.originId, (id) => typeof id === "string" && ID.test(id))
    || !optional(raw.previousAnswerId, (id) => typeof id === "string" && ID.test(id))
    || !integer(raw.questionRevision, 1)
    || !boundedText(raw.question, ANSWER_QUESTION_MAX_CHARS)
    || !boundedText(raw.answer, ANSWER_TEXT_MAX_CHARS, false)
    || normalizeAnswerText(raw.answer) !== raw.answer
    || !optional(raw.clarification, (value) => boundedText(value, ANSWER_REFINEMENT_MAX_CHARS))
    || !optional(raw.refinement, (value) => boundedText(value, ANSWER_REFINEMENT_MAX_CHARS))
    || !["ready", "draft", "needs-input"].includes(String(raw.status))
    || typeof raw.compliant !== "boolean"
    || !Array.isArray(raw.constraints) || raw.constraints.length > 40
    || !isObject(raw.counts) || !exactKeys(raw.counts, ["words", "characters", "sentences"])
    || ![raw.counts.words, raw.counts.characters, raw.counts.sentences].every((n) => integer(n))) return null;
  if (raw.status === "ready" && (!raw.answer.trim() || raw.clarification)) return null;
  if (raw.status === "needs-input" && !raw.clarification) return null;
  for (const constraint of raw.constraints) {
    if (!isObject(constraint) || !exactKeys(constraint, ["unit", "min", "max", "exact", "hard", "scope", "source", "unresolvedScope"])
      || !["words", "characters", "sentences"].includes(String(constraint.unit))
      || !["answer", "each", "total"].includes(String(constraint.scope))
      || !optional(constraint.unresolvedScope, (value) => value === true)
      || typeof constraint.hard !== "boolean" || !boundedText(constraint.source, ANSWER_QUESTION_MAX_CHARS)
      || ![constraint.min, constraint.max, constraint.exact].some((value) => value !== undefined)
      || ![constraint.min, constraint.max, constraint.exact].every((value) => optional(value, (n) => integer(n)))) return null;
  }
  if (raw.status === "ready" && !raw.compliant) return null;
  if (!optional(raw.warnings, (warnings) => Array.isArray(warnings) && warnings.length <= 24 && warnings.every((warning) => boundedText(warning, 2_000)))) return null;
  if (raw.generation !== undefined) {
    const generation = raw.generation;
    if (!isObject(generation) || !exactKeys(generation, ["provider", "model", "reasoningEffort", "createdAt", "attempts", "promptVersion"])
      || !boundedText(generation.provider, 80) || !boundedText(generation.model, 160)
      || !boundedText(generation.reasoningEffort, 40, false) || !boundedText(generation.promptVersion, 120)
      || !timestamp(generation.createdAt) || !integer(generation.attempts, 1, 10)) return null;
  }
  if (raw.sources !== undefined) {
    const keys = ["resumeFingerprint", "profileFingerprint", "jobFingerprint", "rawJobFingerprint", "factsFingerprint"];
    const sources = raw.sources;
    if (!isObject(sources) || !exactKeys(sources, keys) || !keys.every((key) => typeof sources[key] === "string" && HASH.test(sources[key] as string))) return null;
  }
  if (raw.userFacts !== undefined) {
    const userFacts = raw.userFacts;
    if (!isObject(userFacts) || !exactKeys(userFacts, ["provenance", "facts"]) || userFacts.provenance !== "user-declared"
      || !Array.isArray(userFacts.facts) || !userFacts.facts.length || !answerFactsWithinLimits(userFacts.facts)) return null;
  }
  return raw as ApplicationAnswerRevision;
}

const CONSTRAINT_KEYS = ["unit", "min", "max", "exact", "hard", "scope", "source", "unresolvedScope"] as const;
const COUNT_KEYS = ["words", "characters", "sentences"] as const;

// A new revision's limits and counts must come from the current rules for its exact text.
export function answerReceiptIsCurrent(revision: Pick<ApplicationAnswerRevision, "question" | "answer" | "constraints" | "counts" | "compliant">): boolean {
  const constraints = extractAnswerConstraints(revision.question);
  if (revision.constraints.length !== constraints.length
    || revision.constraints.some((constraint, index) => CONSTRAINT_KEYS.some((key) => constraint[key] !== constraints[index][key]))) return false;
  const validation = validateAnswerConstraints(revision.answer, revision.constraints);
  return revision.compliant === validation.compliant && COUNT_KEYS.every((unit) => revision.counts[unit] === validation.counts[unit]);
}

export function parseSavedApplicationAnswers(raw: unknown, applicationId: string): ApplicationAnswer[] | undefined | null {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > MAX_SAVED_ANSWER_REVISIONS || JSON.stringify(raw).length > MAX_SAVED_ANSWERS_CHARS) return null;
  const ids = new Set<string>();
  const questions = new Map<string, string>();
  for (const answer of raw) {
    if (!isObject(answer) || !boundedText(answer.savedAt, 100, false) || !answer.savedAt.length || !boundedText(answer.question, ANSWER_QUESTION_MAX_CHARS, false) || !answer.question.length || !boundedText(answer.answer, ANSWER_TEXT_MAX_CHARS, false) || !answer.answer.length) return null;
    const { savedAt: _savedAt, ...revision } = answer;
    if (exactKeys(revision, ["question", "answer"])) continue;
    const parsed = parseApplicationAnswerRevision(revision);
    if (!parsed || !timestamp(answer.savedAt) || parsed.applicationId !== applicationId || ids.has(parsed.id)) return null;
    const questionKey = `${parsed.questionId}:${parsed.questionRevision}`;
    if (questions.has(questionKey) && questions.get(questionKey) !== parsed.question) return null;
    questions.set(questionKey, parsed.question);
    ids.add(parsed.id);
  }
  return raw.length ? raw as ApplicationAnswer[] : undefined;
}

// Manual tracker edits keep the prior saved revision and get fresh validation.
// AI metadata describes the prior text, so it does not migrate to this revision;
// the user's facts for the question do, and the edited text never joins them.
export function editedSavedApplicationAnswer(
  previous: ApplicationAnswer,
  question: string,
  answer: string,
  id: string,
  savedAt: string,
  questionRevision = (previous.questionRevision ?? 0) + 1
): ApplicationAnswer {
  const normalized = normalizeAnswerText(answer);
  if (!previous.id || !previous.applicationId || !previous.questionId || !previous.questionRevision) {
    return { question, answer: normalized, savedAt };
  }
  const constraints = extractAnswerConstraints(question);
  const validation = validateAnswerConstraints(normalized, constraints);
  return {
    id,
    applicationId: previous.applicationId,
    ...(previous.originId ? { originId: previous.originId } : {}),
    questionId: previous.questionId,
    questionRevision: question !== previous.question ? questionRevision : previous.questionRevision,
    question,
    answer: normalized,
    savedAt,
    previousAnswerId: previous.id,
    constraints,
    counts: validation.counts,
    compliant: validation.compliant,
    status: validation.compliant ? "ready" : "draft",
    ...(previous.userFacts ? { userFacts: previous.userFacts } : {})
  };
}
