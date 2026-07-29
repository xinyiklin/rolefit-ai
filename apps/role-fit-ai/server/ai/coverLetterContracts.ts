// Deterministic validation for the single cover-letter tailoring call. Nothing
// here asks the candidate anything: a violation is collected so the server can
// run one silent repair pass, and only a second failure surfaces as an error.

import { UserSafeAiError } from "./errors.ts";
import type {
  CoverLetterBodyParagraph,
  CoverLetterEvidenceItem,
  CoverLetterEvidenceSource
} from "../../src/lib/coverLetterEvidence.ts";
import {
  hasUnresolvedCoverLetterTokens,
  type ResolvedCoverLetterContext
} from "../../src/lib/coverLetterPreflight.ts";
import type { CoverLetterSourceContext } from "../../src/lib/coverLetterTemplate.ts";

const EVIDENCE_ID = /^[A-Za-z0-9:_-]{1,140}$/;
const EVIDENCE_SOURCES = new Set<CoverLetterEvidenceSource>([
  "resume",
  "honest_context",
  "user_answer"
]);
export const SOURCE_LETTER_EVIDENCE_ID = "source_letter";
const GENERIC_DRAFT_LANGUAGE =
  /\b(?:I am thrilled to apply|I am excited to apply|perfect fit|deeply impressed by|innovative company|dynamic team|proven track record|results[- ]driven|leverage my skills|passionate about the opportunity|seamless(?:ly)?|cutting[- ]edge)\b/i;
const MAX_EVIDENCE_ITEMS = 400;
const MAX_EVIDENCE_TEXT = 4_000;
const MAX_EVIDENCE_TOTAL = 120_000;
export const COVER_LETTER_CHAR_LIMIT = 8_000;
// Quality guidance, not an acceptance gate: a letter outside this band still
// reaches the editor with a warning attached.
export const COVER_LETTER_TARGET_WORDS = { min: 180, max: 420 } as const;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
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
    if (!EVIDENCE_ID.test(id) || ids.has(id) || id === SOURCE_LETTER_EVIDENCE_ID) {
      requestContractError("Cover-letter evidence ids must be unique and stable.");
    }
    if (!EVIDENCE_SOURCES.has(source) || !evidenceText) {
      requestContractError("Each cover-letter evidence item needs a valid source and text.");
    }
    total += evidenceText.length;
    if (total > MAX_EVIDENCE_TOTAL) {
      requestContractError(
        "Cover-letter evidence is too large. Shorten the resume or personal notes."
      );
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

export type CoverLetterTailorOutput = {
  bodyParagraphs: CoverLetterBodyParagraph[];
  warnings: string[];
};

export type CoverLetterTailorValidation = {
  // Null when the response was too malformed to assemble at all.
  output: CoverLetterTailorOutput | null;
  coverLetterText: string;
  violations: string[];
};

export function assembleCoverLetterText(
  bodyParagraphs: CoverLetterBodyParagraph[],
  resolved: ResolvedCoverLetterContext
): string {
  return [
    resolved.date,
    resolved.greeting,
    ...bodyParagraphs.map((paragraph) => paragraph.text),
    resolved.signoff
  ].join("\n\n");
}

export function coverLetterWordCount(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

// Structural + grounding validation of one model response. Never throws for a
// model-authored defect: the caller repairs once, then reports.
export function validateCoverLetterTailorOutput({
  value,
  evidence,
  sourceContext,
  resolved
}: {
  value: unknown;
  evidence: CoverLetterEvidenceItem[];
  sourceContext: CoverLetterSourceContext;
  resolved: ResolvedCoverLetterContext;
}): CoverLetterTailorValidation {
  const violations: string[] = [];
  const parsed = object(value);
  const rawParagraphs = parsed?.bodyParagraphs;
  if (!parsed || !Array.isArray(rawParagraphs) || rawParagraphs.length === 0) {
    return {
      output: null,
      coverLetterText: "",
      violations: ["The response contained no body paragraphs."]
    };
  }
  if (rawParagraphs.length < 2 || rawParagraphs.length > 5) {
    violations.push("Return between 2 and 5 body paragraphs.");
  }

  const allowedIds = new Set(evidence.map((item) => item.id));
  if (sourceContext.authoredProse) allowedIds.add(SOURCE_LETTER_EVIDENCE_ID);
  const generativeSlotIds = new Set(
    sourceContext.slots
      .filter((slot) => slot.resolution.kind === "generate")
      .map((slot) => slot.id)
  );

  const bodyParagraphs: CoverLetterBodyParagraph[] = [];
  for (const raw of rawParagraphs) {
    const paragraph = object(raw);
    const paragraphText = text(paragraph?.text, 3_000);
    if (!paragraphText) {
      violations.push("A body paragraph had no usable text.");
      continue;
    }
    const evidenceIds = Array.isArray(paragraph?.evidenceIds)
      ? [...new Set(paragraph.evidenceIds.map((id) => text(id, 140)).filter(Boolean))]
      : [];
    const slotIds = Array.isArray(paragraph?.slotIds)
      ? [...new Set(paragraph.slotIds.map((id) => text(id, 140)).filter(Boolean))]
      : [];
    const unknownEvidence = evidenceIds.filter((id) => !allowedIds.has(id));
    if (unknownEvidence.length > 0) {
      violations.push(
        `A paragraph cited evidence ids that are not in the supplied corpus: ${unknownEvidence.join(", ")}.`
      );
    }
    if (evidenceIds.length === 0) {
      violations.push("Every body paragraph must cite at least one evidence id it used.");
    }
    const unknownSlots = slotIds.filter((id) => !generativeSlotIds.has(id));
    if (unknownSlots.length > 0) {
      violations.push(
        `A paragraph cited template slot ids that are not generative source slots: ${unknownSlots.join(", ")}.`
      );
    }
    if (hasUnresolvedCoverLetterTokens(paragraphText)) {
      violations.push("A paragraph still contains a bracketed or template token.");
    }
    if (/^\s*Dear\b/im.test(paragraphText)) {
      violations.push("A paragraph includes a greeting. The server owns the greeting.");
    }
    if (/^\s*(?:Sincerely|Regards|Best regards|Respectfully),?\s*$/im.test(paragraphText)) {
      violations.push("A paragraph includes a sign-off. The server owns the sign-off.");
    }
    if (resolved.date && paragraphText.includes(resolved.date)) {
      violations.push("A paragraph includes the correspondence date. The server owns the date.");
    }
    bodyParagraphs.push({
      text: paragraphText,
      evidenceIds: evidenceIds.filter((id) => allowedIds.has(id)),
      slotIds: slotIds.filter((id) => generativeSlotIds.has(id))
    });
  }

  if (bodyParagraphs.length === 0) {
    return {
      output: null,
      coverLetterText: "",
      violations: violations.length > 0 ? violations : ["The response contained no usable prose."]
    };
  }

  const bodyText = bodyParagraphs.map((paragraph) => paragraph.text).join("\n\n");
  const lowerBody = bodyText.toLowerCase();
  if (resolved.role && !lowerBody.includes(resolved.role.toLowerCase())) {
    violations.push(`Name the exact role "${resolved.role}" in the body.`);
  }
  if (resolved.company && !lowerBody.includes(resolved.company.toLowerCase())) {
    violations.push(`Name the company "${resolved.company}" in the body.`);
  }
  if (GENERIC_DRAFT_LANGUAGE.test(bodyText)) {
    violations.push("Remove generic brochure phrasing and filler enthusiasm.");
  }

  const coverLetterText = assembleCoverLetterText(bodyParagraphs, resolved);
  if (hasUnresolvedCoverLetterTokens(coverLetterText)) {
    violations.push("The assembled letter still contains a template token.");
  }
  if (coverLetterText.length > COVER_LETTER_CHAR_LIMIT) {
    violations.push("The letter is far longer than one page. Tighten it substantially.");
  }
  const greetings = coverLetterText
    .split("\n")
    .filter((line) => /^\s*Dear\b/i.test(line)).length;
  if (greetings !== 1) {
    violations.push("The assembled letter must contain exactly one greeting.");
  }

  return {
    output: {
      bodyParagraphs,
      warnings: stringArray(parsed.warnings, 6, 300)
    },
    coverLetterText,
    violations
  };
}

// Advisory notes attached to a letter that already reached the editor.
export function coverLetterLengthWarnings(coverLetterText: string): string[] {
  const words = coverLetterWordCount(coverLetterText);
  if (words < COVER_LETTER_TARGET_WORDS.min) {
    return [`Runs short at ${words} words — check it says enough before sending.`];
  }
  if (words > COVER_LETTER_TARGET_WORDS.max) {
    return [`Runs long at ${words} words — tighten it before exporting.`];
  }
  return [];
}

export function evidenceUsedByParagraphs(
  bodyParagraphs: CoverLetterBodyParagraph[],
  evidence: CoverLetterEvidenceItem[]
): CoverLetterEvidenceItem[] {
  const used = new Set(bodyParagraphs.flatMap((paragraph) => paragraph.evidenceIds));
  return evidence.filter((item) => used.has(item.id));
}

function stringArray(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) return [];
  return value.map((item) => text(item, maxChars)).filter(Boolean);
}
