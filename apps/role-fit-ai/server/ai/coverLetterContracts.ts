import { UserSafeAiError } from "./errors.ts";
import {
  clarificationFieldsForPlan,
  type CoverLetterEvidenceOverride,
  type CoverLetterEvidenceItem,
  type CoverLetterEvidenceSource,
  type CoverLetterPlan,
  type CoverLetterPreparation,
  type CoverLetterProposal,
  type CoverLetterProposalBlock,
  type CoverLetterSlotDecision,
  type CoverLetterVoicePlan,
} from "../../src/lib/coverLetterEvidence.ts";
import {
  hasUnresolvedCoverLetterTokens,
  type CoverLetterSourceMode,
  type ResolvedCoverLetterContext,
} from "../../src/lib/coverLetterPreflight.ts";
import {
  coverLetterHasAuthoredVoice,
  type CoverLetterSourceContext,
  type CoverLetterTemplateSlot,
} from "../../src/lib/coverLetterTemplate.ts";

const EVIDENCE_ID = /^[A-Za-z0-9:_-]{1,140}$/;
const EVIDENCE_SOURCES = new Set<CoverLetterEvidenceSource>([
  "resume",
  "honest_context",
  "user_answer",
]);
const DECISIONS = new Set(["use", "skip", "needs_clarification"]);
const RELEVANCE = new Set(["direct", "supporting", "weak"]);
const FORMALITY = new Set(["conversational-professional", "formal", "direct"]);
const CONFIDENCE = new Set(["restrained", "confident"]);
const SENTENCE_STYLE = new Set(["direct", "varied", "concise"]);
const SLOT_DECISIONS = new Set([
  "resolved",
  "use_job_context",
  "use_candidate_evidence",
  "use_job_and_candidate",
  "needs_input",
]);
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
  throw new UserSafeAiError(
    `AI returned an invalid cover-letter plan: ${message}`,
    502,
  );
}

function requestContractError(message: string): never {
  throw new UserSafeAiError(message, 400);
}

export function parseCoverLetterEvidenceItems(
  value: unknown,
): CoverLetterEvidenceItem[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_EVIDENCE_ITEMS
  ) {
    requestContractError(
      `Cover-letter evidence must contain 1-${MAX_EVIDENCE_ITEMS} items.`,
    );
  }
  const items: CoverLetterEvidenceItem[] = [];
  const ids = new Set<string>();
  let total = 0;
  for (const raw of value) {
    const candidate = object(raw);
    if (!candidate)
      requestContractError(
        "Each cover-letter evidence item must be an object.",
      );
    const id = text(candidate.id, 140);
    const source = text(candidate.source, 40) as CoverLetterEvidenceSource;
    const evidenceText = text(candidate.text, MAX_EVIDENCE_TEXT);
    if (!EVIDENCE_ID.test(id) || ids.has(id)) {
      requestContractError(
        "Cover-letter evidence ids must be unique and stable.",
      );
    }
    if (!EVIDENCE_SOURCES.has(source) || !evidenceText) {
      requestContractError(
        "Each cover-letter evidence item needs a valid source and text.",
      );
    }
    total += evidenceText.length;
    if (total > MAX_EVIDENCE_TOTAL) {
      requestContractError(
        "Cover-letter evidence is too large. Shorten the resume or personal notes.",
      );
    }
    ids.add(id);
    items.push({
      id,
      source,
      text: evidenceText,
      ...(text(candidate.section, 200)
        ? { section: text(candidate.section, 200) }
        : {}),
      ...(text(candidate.entry, 300)
        ? { entry: text(candidate.entry, 300) }
        : {}),
    });
  }
  return items;
}

export function parseCoverLetterEvidenceOverrides(
  value: unknown,
  evidence: CoverLetterEvidenceItem[],
): CoverLetterEvidenceOverride[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > evidence.length) {
    requestContractError("Cover-letter evidence overrides are invalid.");
  }
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const seen = new Set<string>();
  return value.map((raw) => {
    const candidate = object(raw);
    const evidenceId = text(candidate?.evidenceId, 140);
    const decision = text(candidate?.decision, 40);
    if (
      !evidenceIds.has(evidenceId) ||
      seen.has(evidenceId) ||
      (decision !== "use" && decision !== "skip")
    ) {
      requestContractError(
        "Cover-letter evidence overrides must name known evidence exactly once.",
      );
    }
    seen.add(evidenceId);
    return {
      evidenceId,
      decision: decision as CoverLetterEvidenceOverride["decision"],
    };
  });
}

function parseVoice(
  value: unknown,
  contractError: (message: string) => never = providerContractError,
): CoverLetterVoicePlan {
  const voice = object(value);
  if (!voice) contractError("voice is missing.");
  const formality = text(voice.formality, 60);
  const confidence = text(voice.confidence, 40);
  const sentenceStyle = text(voice.sentenceStyle, 40);
  if (
    !FORMALITY.has(formality) ||
    !CONFIDENCE.has(confidence) ||
    !SENTENCE_STYLE.has(sentenceStyle)
  ) {
    contractError("voice contains an unsupported value.");
  }
  return {
    formality: formality as CoverLetterVoicePlan["formality"],
    confidence: confidence as CoverLetterVoicePlan["confidence"],
    sentenceStyle: sentenceStyle as CoverLetterVoicePlan["sentenceStyle"],
  };
}

export function validateCoverLetterPlanForDraft(
  value: unknown,
  selectedEvidence: CoverLetterEvidenceItem[],
  sourceContext: CoverLetterSourceContext,
): CoverLetterPlan {
  const parsed = object(value);
  if (!parsed)
    requestContractError("The prepared cover-letter plan is missing.");
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
    if (!decision)
      requestContractError(
        "The prepared cover-letter plan has an invalid decision.",
      );
    const evidenceId = text(decision.evidenceId, 140);
    const disposition = text(decision.decision, 40);
    const relevance = text(decision.relevance, 40);
    const reason = text(decision.reason, 500);
    if (
      !EVIDENCE_ID.test(evidenceId) ||
      !DECISIONS.has(disposition) ||
      !RELEVANCE.has(relevance) ||
      !reason ||
      (disposition === "use" &&
        relevance === "weak" &&
        decision.userOverridden !== true)
    ) {
      requestContractError(
        "The prepared cover-letter plan has an invalid decision.",
      );
    }
    if (disposition === "needs_clarification") {
      requestContractError("Resolve every clarification before drafting.");
    }
    if (disposition === "use") {
      if (!selectedIds.has(evidenceId) || usedIds.has(evidenceId)) {
        requestContractError(
          "Selected evidence does not match the prepared plan.",
        );
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
      ...(decision.userOverridden === true ? { userOverridden: true } : {}),
    });
  }
  if (
    selectedEvidence.length < 1 ||
    selectedEvidence.length > 3 ||
    usedIds.size !== selectedIds.size
  ) {
    requestContractError("Choose 1-3 evidence items before drafting.");
  }
  const slotDecisions = parseSlotDecisions(
    parsed.slotDecisions,
    sourceContext.slots,
    selectedEvidence,
    requestContractError,
  );
  if (slotDecisions.some((decision) => decision.decision === "needs_input")) {
    requestContractError(
      "Resolve every template-slot question before drafting.",
    );
  }
  return {
    openingAngle,
    decisions,
    slotDecisions,
    voice: parseVoice(parsed.voice, requestContractError),
  };
}

function parseSlotDecisions(
  value: unknown,
  slots: CoverLetterTemplateSlot[],
  evidence: CoverLetterEvidenceItem[],
  contractError: (message: string) => never,
): CoverLetterSlotDecision[] {
  if (!Array.isArray(value) || value.length !== slots.length) {
    contractError("every template slot needs exactly one decision.");
  }
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const seen = new Set<string>();
  const decisions: CoverLetterSlotDecision[] = [];
  for (const raw of value) {
    const candidate = object(raw);
    if (!candidate) contractError("a template-slot decision is not an object.");
    const slotId = text(candidate.slotId, 140);
    const decision = text(candidate.decision, 40);
    const reason = text(candidate.reason, 500);
    const question = text(candidate.question, 500);
    const referencedEvidence = Array.isArray(candidate.evidenceIds)
      ? [
          ...new Set(
            candidate.evidenceIds.map((id) => text(id, 140)).filter(Boolean),
          ),
        ]
      : [];
    const slot = slotById.get(slotId);
    if (
      !slot ||
      seen.has(slotId) ||
      !SLOT_DECISIONS.has(decision) ||
      !reason ||
      referencedEvidence.length > 3 ||
      referencedEvidence.some((id) => !evidenceIds.has(id))
    ) {
      contractError(
        "a template-slot decision has an unknown id, duplicate id, or invalid value.",
      );
    }
    if (slot.resolution.kind === "deterministic" && decision !== "resolved") {
      contractError(
        "deterministic template slots must remain server-resolved.",
      );
    }
    if (slot.resolution.kind === "needs_input" && decision !== "needs_input") {
      contractError(
        "a private factual template slot cannot be inferred from job context.",
      );
    }
    if (
      slot.resolution.kind === "generate" &&
      decision !== "needs_input" &&
      ((slot.resolution.source === "job_context" &&
        decision !== "use_job_context") ||
        (slot.resolution.source === "candidate_evidence" &&
          decision !== "use_candidate_evidence") ||
        (slot.resolution.source === "job_and_candidate" &&
          decision !== "use_job_and_candidate"))
    ) {
      contractError(
        "a template-slot decision does not match its typed source boundary.",
      );
    }
    if (
      decision === "resolved" &&
      (slot.resolution.kind !== "deterministic" ||
        referencedEvidence.length > 0)
    ) {
      contractError(
        "only deterministic template slots may be marked resolved.",
      );
    }
    if (decision === "use_job_context" && referencedEvidence.length > 0) {
      contractError("job-context slots cannot cite candidate evidence.");
    }
    if (
      (decision === "use_candidate_evidence" ||
        decision === "use_job_and_candidate") &&
      referencedEvidence.length < 1
    ) {
      contractError(
        "candidate-connected template slots must cite candidate evidence.",
      );
    }
    if (
      decision === "needs_input" &&
      (!question || referencedEvidence.length > 0)
    ) {
      contractError(
        "a needs-input template slot requires one focused question.",
      );
    }
    seen.add(slotId);
    decisions.push({
      slotId,
      decision: decision as CoverLetterSlotDecision["decision"],
      evidenceIds: referencedEvidence,
      reason,
      ...(question ? { question } : {}),
    });
  }
  return decisions;
}

export function validateCoverLetterPreparationOutput(
  value: unknown,
  evidence: CoverLetterEvidenceItem[],
  sourceMode: CoverLetterSourceMode,
  sourceContext: CoverLetterSourceContext,
  requiresUserVoiceAnchor: boolean,
  evidenceOverrides: CoverLetterEvidenceOverride[] = [],
): CoverLetterPreparation {
  const parsed = object(value);
  if (!parsed) providerContractError("response is not an object.");
  const openingAngle = text(parsed.openingAngle, 500);
  const rawDecisions = parsed.decisions;
  if (
    !openingAngle ||
    !Array.isArray(rawDecisions) ||
    rawDecisions.length !== evidence.length
  ) {
    providerContractError("every evidence item needs exactly one decision.");
  }
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const overrideById = new Map(
    evidenceOverrides.map((override) => [
      override.evidenceId,
      override.decision,
    ]),
  );
  const seen = new Set<string>();
  const decisions: CoverLetterPlan["decisions"] = [];
  for (const raw of rawDecisions) {
    const decision = object(raw);
    if (!decision)
      providerContractError("an evidence decision is not an object.");
    const evidenceId = text(decision.evidenceId, 140);
    const disposition = text(decision.decision, 40);
    const relevance = text(decision.relevance, 40);
    const reason = text(decision.reason, 500);
    const question = text(decision.question, 500);
    const evidenceOverride = overrideById.get(evidenceId);
    if (
      !evidenceIds.has(evidenceId) ||
      seen.has(evidenceId) ||
      !DECISIONS.has(disposition) ||
      !RELEVANCE.has(relevance) ||
      !reason ||
      (disposition === "use" &&
        relevance === "weak" &&
        evidenceOverride !== "use")
    ) {
      providerContractError(
        "an evidence decision has an unknown id, duplicate id, or invalid value.",
      );
    }
    if (disposition === "needs_clarification" && !question) {
      providerContractError(
        "a clarification decision needs a focused question.",
      );
    }
    if (evidenceOverride && disposition !== evidenceOverride) {
      providerContractError("a candidate evidence override was not preserved.");
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
      ...(question ? { question } : {}),
      ...(evidenceOverride ? { userOverridden: true } : {}),
    });
  }
  if (seen.size !== evidenceIds.size) {
    providerContractError("one or more evidence ids were omitted.");
  }
  const selectedCount = decisions.filter(
    (decision) => decision.decision === "use",
  ).length;
  const clarificationCount = decisions.filter(
    (decision) => decision.decision === "needs_clarification",
  ).length;
  if (selectedCount > 3 || (clarificationCount === 0 && selectedCount < 1)) {
    providerContractError("the plan must select 1-3 evidence items.");
  }
  if (
    requiresUserVoiceAnchor &&
    clarificationCount === 0 &&
    !decisions.some(
      (decision) =>
        decision.decision === "use" &&
        evidence.find((item) => item.id === decision.evidenceId)?.source ===
          "user_answer",
    )
  ) {
    providerContractError(
      "a guided plan without authored voice must select a candidate answer.",
    );
  }
  const slotDecisions = parseSlotDecisions(
    parsed.slotDecisions,
    sourceContext.slots,
    evidence,
    providerContractError,
  );
  const usedEvidenceIds = new Set(
    decisions
      .filter((decision) => decision.decision === "use")
      .map((decision) => decision.evidenceId),
  );
  for (const slotDecision of slotDecisions) {
    if (
      (slotDecision.decision === "use_candidate_evidence" ||
        slotDecision.decision === "use_job_and_candidate") &&
      slotDecision.evidenceIds.some((id) => !usedEvidenceIds.has(id))
    ) {
      providerContractError(
        "template slots may cite only evidence selected by the plan.",
      );
    }
  }
  const slotClarifications = slotDecisions
    .filter((decision) => decision.decision === "needs_input")
    .map((decision) => {
      const slot = sourceContext.slots.find(
        (item) => item.id === decision.slotId,
      );
      return {
        evidenceId: decision.slotId,
        label: slot?.normalizedPrompt || "Template detail",
        required: true as const,
        reason: decision.question || decision.reason,
      };
    });
  const plan: CoverLetterPlan = {
    openingAngle,
    decisions,
    slotDecisions,
    voice: parseVoice(parsed.voice),
  };
  const clarifications = [
    ...clarificationFieldsForPlan(plan, evidence),
    ...slotClarifications,
  ];
  return {
    status: clarifications.length > 0 ? "needs_input" : "ready",
    sourceMode,
    missingFields: [],
    clarifications,
    plan,
  };
}

function stringArray(
  value: unknown,
  maxItems: number,
  maxChars: number,
): string[] {
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
  sourceContext: CoverLetterSourceContext,
  plan: CoverLetterPlan,
  resolved: ResolvedCoverLetterContext,
): ValidatedCoverLetterDraftOutput {
  const parsed = object(value);
  if (!parsed) providerContractError("draft response is not an object.");
  const rawParagraphs = parsed.bodyParagraphs;
  if (
    !Array.isArray(rawParagraphs) ||
    rawParagraphs.length < 2 ||
    rawParagraphs.length > 5
  ) {
    providerContractError("draft needs 2-5 body paragraphs.");
  }
  const allowedIds = new Set(selectedEvidence.map((item) => item.id));
  const hasAuthoredVoice = coverLetterHasAuthoredVoice(
    sourceContext.authoredProse,
  );
  if (sourceContext.authoredProse) allowedIds.add(SOURCE_LETTER_EVIDENCE_ID);
  const generativeSlotIds = new Set(
    sourceContext.slots
      .filter((slot) => slot.resolution.kind === "generate")
      .map((slot) => slot.id),
  );
  const slotDecisionById = new Map(
    plan.slotDecisions.map((decision) => [decision.slotId, decision]),
  );
  const addressedSlotIds = new Set<string>();
  const bodyBlocks: CoverLetterProposalBlock[] = rawParagraphs.map((raw) => {
    const paragraph = object(raw);
    if (!paragraph) providerContractError("a body paragraph is not an object.");
    const paragraphText = text(paragraph.text, 3_000);
    const ids = Array.isArray(paragraph.evidenceIds)
      ? [
          ...new Set(
            paragraph.evidenceIds.map((id) => text(id, 140)).filter(Boolean),
          ),
        ]
      : [];
    const slotIds = Array.isArray(paragraph.slotIds)
      ? [
          ...new Set(
            paragraph.slotIds.map((id) => text(id, 140)).filter(Boolean),
          ),
        ]
      : [];
    if (
      !paragraphText ||
      ids.length === 0 ||
      ids.length > 4 ||
      ids.some((id) => !allowedIds.has(id)) ||
      slotIds.some((id) => !generativeSlotIds.has(id)) ||
      hasUnresolvedCoverLetterTokens(paragraphText) ||
      /^\s*Dear\b/im.test(paragraphText) ||
      /^\s*(?:Sincerely|Regards|Best regards|Respectfully),?\s*$/im.test(
        paragraphText,
      ) ||
      paragraphText.includes(resolved.date)
    ) {
      providerContractError(
        "a body paragraph has invalid text or evidence ids.",
      );
    }
    for (const slotId of slotIds) {
      const slotDecision = slotDecisionById.get(slotId);
      if (
        !slotDecision ||
        slotDecision.decision === "resolved" ||
        slotDecision.decision === "needs_input"
      ) {
        providerContractError(
          "a body paragraph cites a slot not approved for generation.",
        );
      }
      if (
        (slotDecision.decision === "use_candidate_evidence" ||
          slotDecision.decision === "use_job_and_candidate") &&
        !slotDecision.evidenceIds.some((id) => ids.includes(id))
      ) {
        providerContractError(
          "a candidate-connected slot must cite its approved evidence.",
        );
      }
      addressedSlotIds.add(slotId);
    }
    return { kind: "body", text: paragraphText, evidenceIds: ids, slotIds };
  });
  if ([...generativeSlotIds].some((slotId) => !addressedSlotIds.has(slotId))) {
    providerContractError(
      "every generative template slot must be addressed by a body paragraph.",
    );
  }
  const bodyText = bodyBlocks.map((block) => block.text).join("\n\n");
  if (
    !bodyText.toLowerCase().includes(resolved.role.toLowerCase()) ||
    GENERIC_DRAFT_LANGUAGE.test(bodyText)
  ) {
    providerContractError(
      "the body omits the resolved role or uses generic draft language.",
    );
  }
  const preservedFromSource = stringArray(parsed.preservedFromSource, 6, 300);
  if (
    hasAuthoredVoice &&
    (preservedFromSource.length === 0 ||
      !bodyBlocks.some((block) =>
        block.evidenceIds.includes(SOURCE_LETTER_EVIDENCE_ID),
      ))
  ) {
    providerContractError(
      "an authored draft must identify preserved source prose.",
    );
  }
  return {
    bodyBlocks,
    changeSummary: stringArray(parsed.changeSummary, 6, 300),
    preservedFromSource,
    warnings: stringArray(parsed.warnings, 6, 300),
  };
}

export function assembleCoverLetterProposal(
  output: ValidatedCoverLetterDraftOutput,
  resolved: ResolvedCoverLetterContext,
  selectedEvidence: CoverLetterEvidenceItem[],
): CoverLetterProposal {
  const blocks: CoverLetterProposalBlock[] = [
    { kind: "date", text: resolved.date, evidenceIds: [] },
    { kind: "greeting", text: resolved.greeting, evidenceIds: [] },
    ...output.bodyBlocks,
    { kind: "signoff", text: resolved.signoff, evidenceIds: [] },
  ];
  const coverLetterText = blocks.map((block) => block.text).join("\n\n");
  const words = coverLetterText.split(/\s+/).filter(Boolean).length;
  if (
    coverLetterText.length > 8_000 ||
    words < 180 ||
    words > 420 ||
    hasUnresolvedCoverLetterTokens(coverLetterText)
  ) {
    providerContractError(
      "assembled draft violates the length or placeholder invariant.",
    );
  }
  return {
    status: "ready",
    coverLetterText,
    blocks,
    changeSummary: output.changeSummary,
    preservedFromSource: output.preservedFromSource,
    warnings: output.warnings,
    readyToSend: true,
    selectedEvidence,
  };
}
