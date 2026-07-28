import type {
  CoverLetterEvidenceItem,
  CoverLetterPlan,
  CoverLetterProposal
} from "../../src/lib/coverLetterEvidence.ts";
import type {
  CoverLetterSourceMode,
  ResolvedCoverLetterContext
} from "../../src/lib/coverLetterPreflight.ts";
import { hasUnresolvedCoverLetterTokens } from "../../src/lib/coverLetterPreflight.ts";

const GENERIC_AI_LANGUAGE =
  /\b(?:I am thrilled to apply|I am excited to apply|perfect fit|deeply impressed by|innovative company|dynamic team|proven track record|results[- ]driven|leverage my skills|passionate about the opportunity|seamless(?:ly)?|cutting[- ]edge)\b/i;

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
  proposal: CoverLetterProposal;
  plan: CoverLetterPlan;
  allEvidence: CoverLetterEvidenceItem[];
  sourceMode: CoverLetterSourceMode;
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

function normalizedWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function hasPreservedSourcePhrase(sourceText: string, bodyText: string): boolean {
  const sourceWords = normalizedWords(sourceText);
  const normalizedBody = ` ${normalizedWords(bodyText).join(" ")} `;
  for (let index = 0; index <= sourceWords.length - 4; index += 1) {
    const phrase = sourceWords.slice(index, index + 4).join(" ");
    if (
      !/dear|sincerely|regards|hiring team/.test(phrase) &&
      !GENERIC_AI_LANGUAGE.test(phrase) &&
      sourceWords.slice(index, index + 4).some((word) => word.length >= 6) &&
      normalizedBody.includes(` ${phrase} `)
    ) {
      return true;
    }
  }
  return false;
}

export function gradeCoverLetterProposal({
  proposal,
  plan,
  allEvidence,
  sourceMode,
  sourceText = "",
  resolved,
  onePage
}: GradeCoverLetterInput): CoverLetterQualityReport {
  const bodyBlocks = proposal.blocks.filter((block) => block.kind === "body");
  const bodyText = bodyBlocks.map((block) => block.text).join("\n\n");
  const selectedIds = new Set(proposal.selectedEvidence.map((item) => item.id));
  const selectedDecisions = plan.decisions.filter((decision) => selectedIds.has(decision.evidenceId));
  const skippedEvidence = allEvidence.filter((item) => !selectedIds.has(item.id));
  const leakedSkipped = skippedEvidence.filter(
    (item) => item.text.length >= 20 && bodyText.toLowerCase().includes(item.text.toLowerCase())
  );
  const paragraphEvidenceValid = bodyBlocks.every(
    (block) =>
      block.evidenceIds.length > 0 &&
      block.evidenceIds.every(
        (id) => selectedIds.has(id) || (sourceMode === "authored_letter" && id === "source_letter")
      )
  );
  const relevantSelection = selectedDecisions.every(
    (decision) => decision.relevance !== "weak" || decision.userOverridden === true
  );
  const hasSourceVoice =
    sourceMode === "guided_draft" ||
    (proposal.preservedFromSource.length > 0 &&
      bodyBlocks.some((block) => block.evidenceIds.includes("source_letter")) &&
      hasPreservedSourcePhrase(sourceText, bodyText));
  const wordCount = words(proposal.coverLetterText);

  const checks: Record<string, CoverLetterQualityCheck> = {
    placeholders: check(
      !hasUnresolvedCoverLetterTokens(proposal.coverLetterText),
      "No unresolved bracketed, mustache, or template tokens."
    ),
    evidenceGrounding: check(
      paragraphEvidenceValid && selectedIds.size >= 1 && selectedIds.size <= 3,
      "Every body paragraph cites selected evidence and the proposal uses 1-3 atomic items."
    ),
    evidenceRelevance: check(
      relevantSelection,
      "Selected evidence is direct or supporting unless the candidate explicitly overrode it."
    ),
    skippedEvidence: check(
      leakedSkipped.length === 0,
      leakedSkipped.length
        ? "Skipped evidence appears verbatim in the body."
        : "Skipped evidence does not appear verbatim in the body."
    ),
    sourceVoice: check(
      hasSourceVoice,
      sourceMode === "authored_letter"
        ? "Authored mode identifies and retains a meaningful four-word source phrase."
        : "Guided mode uses candidate answers as its voice source."
    ),
    focusedNarrative: check(
      selectedIds.size <= 3 && bodyBlocks.length >= 2 && bodyBlocks.length <= 5,
      "The proposal uses a focused 2-5 paragraph narrative rather than a resume dump."
    ),
    specificFit: check(
      proposal.coverLetterText.toLowerCase().includes(resolved.role.toLowerCase()) &&
        proposal.coverLetterText.toLowerCase().includes(resolved.company.toLowerCase()),
      "The resolved role and company are named."
    ),
    correspondence: check(
      proposal.blocks[0]?.kind === "date" &&
        proposal.blocks[0]?.text === resolved.date &&
        proposal.blocks[1]?.kind === "greeting" &&
        proposal.blocks[1]?.text === resolved.greeting &&
        proposal.blocks.at(-1)?.kind === "signoff" &&
        proposal.blocks.at(-1)?.text === resolved.signoff,
      "Date, greeting, and sign-off exactly match deterministic correspondence."
    ),
    concise: check(
      wordCount >= 180 && wordCount <= 420 && onePage,
      `Proposal is ${wordCount} words and ${onePage ? "one page" : "not one page"}.`
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
