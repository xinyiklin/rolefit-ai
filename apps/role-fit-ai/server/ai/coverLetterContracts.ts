import { UserSafeAiError } from "./errors.ts";
import {
  clarificationFieldsForPlan,
  type CoverLetterEvidenceItem,
  type CoverLetterEvidenceSource,
  type CoverLetterPlan,
  type CoverLetterPreparation,
  type CoverLetterProposal,
  type CoverLetterProposalBlock,
  type CoverLetterVoicePlan
} from "../../src/lib/coverLetterEvidence.ts";
import {
  hasUnresolvedCoverLetterTokens,
  type CoverLetterSourceMode,
  type ResolvedCoverLetterContext
} from "../../src/lib/coverLetterPreflight.ts";

const EVIDENCE_ID = /^[A-Za-z0-9:_-]{1,140}$/;
const EVIDENCE_SOURCES = new Set<CoverLetterEvidenceSource>([
  "resume",
  "honest_context",
  "user_answer"
]);
const DECISIONS = new Set(["use", "skip", "needs_clarification"]);
const RELEVANCE = new Set(["direct", "supporting", "weak"]);
const FORMALITY = new Set(["conversational-professional", "formal", "direct"]);
const CONFIDENCE = new Set(["restrained", "confident"]);
const SENTENCE_STYLE = new Set(["direct", "varied", "concise"]);
const SOURCE_LETTER_EVIDENCE_ID = "source_letter";
const GENERIC_DRAFT_LANGUAGE =
  /\b(?:I am thrilled to apply|I am excited to apply|perfect fit|deeply impressed by|innovative company|dynamic team|proven track record|results[- ]driven|leverage my skills|passionate about the opportunity|seamless(?:ly)?|cutting[- ]edge)\b/i;
const MAX_EVIDENCE_ITEMS = 80;
const MAX_EVIDENCE_TEXT = 4_000;
const MAX_EVIDENCE_TOTAL = 60_000;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function providerContractError(message: string): never {
  throw new UserSafeAiError(`AI returned an invalid cover-letter plan: ${message}`, 502);
}

function requestContractError(message: string): never {
  throw new UserSafeAiError(message, 400);
}

export function parseCoverLetterEvidenceItems(value: unknown): CoverLetterEvidenceItem[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EVIDENCE_ITEMS) {
    requestContractError(`Cover-letter evidence must contain 1-${MAX_EVIDENCE_ITEMS} items.`);
  }
  const items: CoverLetterEvidenceItem[] = [];
  const ids = new Set<string>();
  let total = 0;
  for (const raw of value) {
    const candidate = object(raw);
    if (!candidate) requestContractError("Each cover-letter evidence item must be an object.");
    const id = text(candidate.id, 140);
    const source = text(candidate.source, 40) as CoverLetterEvidenceSource;
    const evidenceText = text(candidate.text, MAX_EVIDENCE_TEXT);
    if (!EVIDENCE_ID.test(id) || ids.has(id)) {
      requestContractError("Cover-letter evidence ids must be unique and stable.");
    }
    if (!EVIDENCE_SOURCES.has(source) || !evidenceText) {
      requestContractError("Each cover-letter evidence item needs a valid source and text.");
    }
    total += evidenceText.length;
    if (total > MAX_EVIDENCE_TOTAL) {
      requestContractError("Cover-letter evidence is too large. Shorten the resume or personal notes.");
    }
    ids.add(id);
    items.push({
      id,
      source,
      text: evidenceText,
      ...(text(candidate.section, 200) ? { section: text(candidate.section, 200) } : {}),
      ...(text(candidate.entry, 300) ? { entry: text(candidate.entry, 300) } : {})
    });
  }
  return items;
}

function parseVoice(
  value: unknown,
  contractError: (message: string) => never = providerContractError
): CoverLetterVoicePlan {
  const voice = object(value);
  if (!voice) contractError("voice is missing.");
  const formality = text(voice.formality, 60);
  const confidence = text(voice.confidence, 40);
  const sentenceStyle = text(voice.sentenceStyle, 40);
  if (!FORMALITY.has(formality) || !CONFIDENCE.has(confidence) || !SENTENCE_STYLE.has(sentenceStyle)) {
    contractError("voice contains an unsupported value.");
  }
  return {
    formality: formality as CoverLetterVoicePlan["formality"],
    confidence: confidence as CoverLetterVoicePlan["confidence"],
    sentenceStyle: sentenceStyle as CoverLetterVoicePlan["sentenceStyle"]
  };
}

export function validateCoverLetterPlanForDraft(
  value: unknown,
  selectedEvidence: CoverLetterEvidenceItem[]
): CoverLetterPlan {
  const parsed = object(value);
  if (!parsed) requestContractError("The prepared cover-letter plan is missing.");
  const openingAngle = text(parsed.openingAngle, 500);
  const rawDecisions = parsed.decisions;
  if (!openingAngle || !Array.isArray(rawDecisions)) {
    requestContractError("The prepared cover-letter plan is incomplete.");
  }
  const selectedIds = new Set(selectedEvidence.map((item) => item.id));
  const usedIds = new Set<string>();
  const decisions: CoverLetterPlan["decisions"] = [];
  for (const raw of rawDecisions) {
    const decision = object(raw);
    if (!decision) requestContractError("The prepared cover-letter plan has an invalid decision.");
    const evidenceId = text(decision.evidenceId, 140);
    const disposition = text(decision.decision, 40);
    const relevance = text(decision.relevance, 40);
    const reason = text(decision.reason, 500);
    if (
      !EVIDENCE_ID.test(evidenceId) ||
      !DECISIONS.has(disposition) ||
      !RELEVANCE.has(relevance) ||
      !reason ||
      (disposition === "use" && relevance === "weak" && decision.userOverridden !== true)
    ) {
      requestContractError("The prepared cover-letter plan has an invalid decision.");
    }
    if (disposition === "needs_clarification") {
      requestContractError("Resolve every clarification before drafting.");
    }
    if (disposition === "use") {
      if (!selectedIds.has(evidenceId) || usedIds.has(evidenceId)) {
        requestContractError("Selected evidence does not match the prepared plan.");
      }
      usedIds.add(evidenceId);
    }
    decisions.push({
      evidenceId,
      decision: disposition as CoverLetterPlan["decisions"][number]["decision"],
      relevance: relevance as CoverLetterPlan["decisions"][number]["relevance"],
      reason,
      ...(text(decision.targetRequirement, 300)
        ? { targetRequirement: text(decision.targetRequirement, 300) }
        : {}),
      ...(decision.userOverridden === true ? { userOverridden: true } : {})
    });
  }
  if (
    selectedEvidence.length < 1 ||
    selectedEvidence.length > 3 ||
    usedIds.size !== selectedIds.size
  ) {
    requestContractError("Choose 1-3 evidence items before drafting.");
  }
  return { openingAngle, decisions, voice: parseVoice(parsed.voice, requestContractError) };
}

export function validateCoverLetterPreparationOutput(
  value: unknown,
  evidence: CoverLetterEvidenceItem[],
  sourceMode: CoverLetterSourceMode
): CoverLetterPreparation {
  const parsed = object(value);
  if (!parsed) providerContractError("response is not an object.");
  const openingAngle = text(parsed.openingAngle, 500);
  const rawDecisions = parsed.decisions;
  if (!openingAngle || !Array.isArray(rawDecisions) || rawDecisions.length !== evidence.length) {
    providerContractError("every evidence item needs exactly one decision.");
  }
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const seen = new Set<string>();
  const decisions: CoverLetterPlan["decisions"] = [];
  for (const raw of rawDecisions) {
    const decision = object(raw);
    if (!decision) providerContractError("an evidence decision is not an object.");
    const evidenceId = text(decision.evidenceId, 140);
    const disposition = text(decision.decision, 40);
    const relevance = text(decision.relevance, 40);
    const reason = text(decision.reason, 500);
    const question = text(decision.question, 500);
    if (
      !evidenceIds.has(evidenceId) ||
      seen.has(evidenceId) ||
      !DECISIONS.has(disposition) ||
      !RELEVANCE.has(relevance) ||
      !reason ||
      (disposition === "use" && relevance === "weak")
    ) {
      providerContractError("an evidence decision has an unknown id, duplicate id, or invalid value.");
    }
    if (disposition === "needs_clarification" && !question) {
      providerContractError("a clarification decision needs a focused question.");
    }
    seen.add(evidenceId);
    decisions.push({
      evidenceId,
      decision: disposition as CoverLetterPlan["decisions"][number]["decision"],
      relevance: relevance as CoverLetterPlan["decisions"][number]["relevance"],
      reason,
      ...(text(decision.targetRequirement, 300)
        ? { targetRequirement: text(decision.targetRequirement, 300) }
        : {}),
      ...(question ? { question } : {})
    });
  }
  if (seen.size !== evidenceIds.size) {
    providerContractError("one or more evidence ids were omitted.");
  }
  const selectedCount = decisions.filter((decision) => decision.decision === "use").length;
  const clarificationCount = decisions.filter(
    (decision) => decision.decision === "needs_clarification"
  ).length;
  if (selectedCount > 3 || (clarificationCount === 0 && selectedCount < 1)) {
    providerContractError("the plan must select 1-3 evidence items.");
  }
  if (
    sourceMode === "guided_draft" &&
    clarificationCount === 0 &&
    !decisions.some(
      (decision) =>
        decision.decision === "use" &&
        evidence.find((item) => item.id === decision.evidenceId)?.source === "user_answer"
    )
  ) {
    providerContractError("a guided plan must select at least one candidate answer.");
  }
  const plan: CoverLetterPlan = {
    openingAngle,
    decisions,
    voice: parseVoice(parsed.voice)
  };
  return {
    status: clarificationCount > 0 ? "needs_input" : "ready",
    sourceMode,
    missingFields: [],
    clarifications: clarificationFieldsForPlan(plan, evidence),
    plan
  };
}

function stringArray(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) return [];
  return value.map((item) => text(item, maxChars)).filter(Boolean);
}

export type ValidatedCoverLetterDraftOutput = {
  bodyBlocks: CoverLetterProposalBlock[];
  changeSummary: string[];
  preservedFromSource: string[];
  warnings: string[];
};

export function validateCoverLetterDraftOutput(
  value: unknown,
  selectedEvidence: CoverLetterEvidenceItem[],
  sourceMode: CoverLetterSourceMode,
  resolved: ResolvedCoverLetterContext
): ValidatedCoverLetterDraftOutput {
  const parsed = object(value);
  if (!parsed) providerContractError("draft response is not an object.");
  const rawParagraphs = parsed.bodyParagraphs;
  if (!Array.isArray(rawParagraphs) || rawParagraphs.length < 2 || rawParagraphs.length > 5) {
    providerContractError("draft needs 2-5 body paragraphs.");
  }
  const allowedIds = new Set(selectedEvidence.map((item) => item.id));
  if (sourceMode === "authored_letter") allowedIds.add(SOURCE_LETTER_EVIDENCE_ID);
  const bodyBlocks: CoverLetterProposalBlock[] = rawParagraphs.map((raw) => {
    const paragraph = object(raw);
    if (!paragraph) providerContractError("a body paragraph is not an object.");
    const paragraphText = text(paragraph.text, 3_000);
    const ids = Array.isArray(paragraph.evidenceIds)
      ? [...new Set(paragraph.evidenceIds.map((id) => text(id, 140)).filter(Boolean))]
      : [];
    if (
      !paragraphText ||
      ids.length === 0 ||
      ids.length > 4 ||
      ids.some((id) => !allowedIds.has(id)) ||
      hasUnresolvedCoverLetterTokens(paragraphText) ||
      /^\s*Dear\b/im.test(paragraphText) ||
      /^\s*(?:Sincerely|Regards|Best regards|Respectfully),?\s*$/im.test(paragraphText) ||
      paragraphText.includes(resolved.date)
    ) {
      providerContractError("a body paragraph has invalid text or evidence ids.");
    }
    return { kind: "body", text: paragraphText, evidenceIds: ids };
  });
  const bodyText = bodyBlocks.map((block) => block.text).join("\n\n");
  if (
    !bodyText.toLowerCase().includes(resolved.role.toLowerCase()) ||
    GENERIC_DRAFT_LANGUAGE.test(bodyText)
  ) {
    providerContractError("the body omits the resolved role or uses generic draft language.");
  }
  const preservedFromSource = stringArray(parsed.preservedFromSource, 6, 300);
  if (
    sourceMode === "authored_letter" &&
    (preservedFromSource.length === 0 ||
      !bodyBlocks.some((block) => block.evidenceIds.includes(SOURCE_LETTER_EVIDENCE_ID)))
  ) {
    providerContractError("an authored draft must identify preserved source prose.");
  }
  return {
    bodyBlocks,
    changeSummary: stringArray(parsed.changeSummary, 6, 300),
    preservedFromSource,
    warnings: stringArray(parsed.warnings, 6, 300)
  };
}

export function assembleCoverLetterProposal(
  output: ValidatedCoverLetterDraftOutput,
  resolved: ResolvedCoverLetterContext,
  selectedEvidence: CoverLetterEvidenceItem[]
): CoverLetterProposal {
  const blocks: CoverLetterProposalBlock[] = [
    { kind: "date", text: resolved.date, evidenceIds: [] },
    { kind: "greeting", text: resolved.greeting, evidenceIds: [] },
    ...output.bodyBlocks,
    { kind: "signoff", text: resolved.signoff, evidenceIds: [] }
  ];
  const coverLetterText = blocks.map((block) => block.text).join("\n\n");
  const words = coverLetterText.split(/\s+/).filter(Boolean).length;
  if (
    coverLetterText.length > 8_000 ||
    words < 180 ||
    words > 420 ||
    hasUnresolvedCoverLetterTokens(coverLetterText)
  ) {
    providerContractError("assembled draft violates the length or placeholder invariant.");
  }
  return {
    status: "ready",
    coverLetterText,
    blocks,
    changeSummary: output.changeSummary,
    preservedFromSource: output.preservedFromSource,
    warnings: output.warnings,
    readyToSend: true,
    selectedEvidence
  };
}
