// Quality grading for the live cover-letter eval. These are aspirational
// standards, not acceptance gates — the server's own validation decides what
// reaches the editor, and a letter can be shippable while scoring below 100.

import type {
  CoverLetterEvidenceItem,
  CoverLetterTailorResult
} from "../../src/lib/coverLetterEvidence.ts";
import {
  hasUnresolvedCoverLetterTokens,
  type ResolvedCoverLetterContext
} from "../../src/lib/coverLetterPreflight.ts";

const GENERIC_AI_LANGUAGE =
  /\b(?:I am thrilled to apply|I am excited to apply|perfect fit|deeply impressed by|innovative company|dynamic team|proven track record|results[- ]driven|leverage my skills|passionate about the opportunity|seamless(?:ly)?|cutting[- ]edge)\b/i;
const SOURCE_LETTER_EVIDENCE_ID = "source_letter";

export type CoverLetterQualityCheck = {
  passed: boolean;
  detail: string;
};

export type CoverLetterQualityReport = {
  passed: boolean;
  score: number;
  checks: Record<string, CoverLetterQualityCheck>;
};

type GradeCoverLetterInput = {
  result: CoverLetterTailorResult;
  allEvidence: CoverLetterEvidenceItem[];
  sourceText?: string;
  resolved: ResolvedCoverLetterContext;
  onePage: boolean;
};

function words(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function check(passed: boolean, detail: string): CoverLetterQualityCheck {
  return { passed, detail };
}

export function gradeCoverLetterResult({
  result,
  allEvidence,
  sourceText = "",
  resolved,
  onePage
}: GradeCoverLetterInput): CoverLetterQualityReport {
  const bodyText = result.bodyParagraphs.map((paragraph) => paragraph.text).join("\n\n");
  const knownIds = new Set(allEvidence.map((item) => item.id));
  if (sourceText.trim()) knownIds.add(SOURCE_LETTER_EVIDENCE_ID);
  const citedIds = new Set(result.bodyParagraphs.flatMap((paragraph) => paragraph.evidenceIds));
  const paragraphEvidenceValid = result.bodyParagraphs.every(
    (paragraph) =>
      paragraph.evidenceIds.length > 0 && paragraph.evidenceIds.every((id) => knownIds.has(id))
  );
  // A cover letter elaborates; pasting a whole resume bullet is the failure mode
  // that reads as a resume dump.
  const verbatimReuse = allEvidence.filter(
    (item) => item.text.length >= 60 && bodyText.toLowerCase().includes(item.text.toLowerCase())
  );
  const wordCount = words(result.coverLetterText);
  const lowerLetter = result.coverLetterText.toLowerCase();

  const checks: Record<string, CoverLetterQualityCheck> = {
    placeholders: check(
      !hasUnresolvedCoverLetterTokens(result.coverLetterText),
      "No unresolved bracketed, mustache, or template tokens."
    ),
    evidenceGrounding: check(
      paragraphEvidenceValid && citedIds.size >= 1,
      "Every body paragraph cites evidence that exists in the supplied corpus."
    ),
    focusedNarrative: check(
      result.bodyParagraphs.length >= 2 &&
        result.bodyParagraphs.length <= 5 &&
        citedIds.size <= 6,
      "A focused 2-5 paragraph narrative built from a handful of connections."
    ),
    noResumeDump: check(
      verbatimReuse.length === 0,
      verbatimReuse.length
        ? "A resume bullet was pasted verbatim instead of elaborated."
        : "Evidence is elaborated rather than pasted."
    ),
    specificFit: check(
      lowerLetter.includes(resolved.role.toLowerCase()) &&
        lowerLetter.includes(resolved.company.toLowerCase()),
      "The resolved role and company are named."
    ),
    correspondence: check(
      result.coverLetterText.startsWith(`${resolved.date}\n\n${resolved.greeting}`) &&
        result.coverLetterText.endsWith(resolved.signoff) &&
        result.coverLetterText.split("\n").filter((line) => /^\s*Dear\b/i.test(line)).length === 1,
      "Date, greeting, and sign-off exactly match deterministic correspondence."
    ),
    concise: check(
      wordCount >= 180 && wordCount <= 420 && onePage,
      `Letter is ${wordCount} words and ${onePage ? "one page" : "not one page"}.`
    ),
    naturalLanguage: check(
      !GENERIC_AI_LANGUAGE.test(bodyText),
      "The body avoids generic AI and brochure phrasing."
    )
  };
  const passedCount = Object.values(checks).filter((item) => item.passed).length;
  return {
    passed: passedCount === Object.keys(checks).length,
    score: Math.round((passedCount / Object.keys(checks).length) * 100),
    checks
  };
}
