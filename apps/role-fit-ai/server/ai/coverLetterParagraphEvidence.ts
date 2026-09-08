import {
  evidenceEntryName,
  type CoverLetterEvidenceItem,
  type CoverLetterBodyParagraph
} from "../../src/lib/coverLetterEvidence.ts";
import type { ResolvedCoverLetterContext } from "../../src/lib/coverLetterPreflight.ts";
import type { CoverLetterValidationIssue } from "./coverLetterIssues.ts";
import { affirmativeEvidence, candidateClaimIssue, evidenceSegments, hasContradictoryClaimEvidence } from "./claimEvidence.ts";
import { hasUnsupportedOwnershipIncrease, isTermGrounded } from "./grounding.ts";
import { candidateClaimSentences, coverLetterGroundingIssues } from "./coverLetterGroundingIssues.ts";

function unsupportedAffiliation(sentence: string, grounding: string): string | null {
  // Explicit prior affiliations need candidate evidence; ordinary acronyms are
  // not names merely because they are capitalized.
  const affiliations = /(?:^At |\b(?:worked (?:at|for)|employed by|joined|my (?:work|role|time) at) )([A-Z][\p{L}\p{N}.'’&-]*(?:[ \t]+(?!(?:I|We|My|Our)\b)[A-Z][\p{L}\p{N}.'’&-]*)*)/gu;
  for (const match of sentence.matchAll(affiliations)) {
    if (!isTermGrounded(match[1], grounding)) return `Unsupported affiliation: ${match[1]}`;
  }
  return null;
}

export function coverLetterParagraphClaims({
  paragraphs, evidence, authoredProse, jobText, employerContext, resolved
}: {
  paragraphs: CoverLetterBodyParagraph[];
  evidence: CoverLetterEvidenceItem[];
  authoredProse: string;
  jobText: string;
  employerContext?: string;
  resolved: ResolvedCoverLetterContext;
}): { issues: CoverLetterValidationIssue[]; warnings: string[] } {
  const issues: CoverLetterValidationIssue[] = [];
  const warnings: string[] = [];
  const sources = evidence.map((item) => ({
    id: item.id, entry: evidenceEntryName(item.entry),
    text: `${item.entry ?? ""}\n${item.text}`
  }));
  if (authoredProse) sources.push({ id: "source_letter", entry: "", text: authoredProse });
  const employer = `${jobText}\n${employerContext ?? ""}`;
  for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
    const cited = sources.filter((source) => paragraph.evidenceIds.includes(source.id));
    const candidateSentences = candidateClaimSentences(paragraph.text, resolved);
    for (const sentence of evidenceSegments(paragraph.text)) {
      const isCandidate = candidateSentences.some((candidate) => candidate.includes(sentence));
      const named = isCandidate ? sources.filter((source) => source.entry &&
        new RegExp(`(?:^|[^\\p{L}\\p{N}])${source.entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}])`, "iu").test(sentence)) : [];
      const names = new Set(named.map((source) => source.entry));
      // Explicitly named work cannot borrow another entry's tools or outcomes.
      const allowed = names.size === 1 ? cited.filter((source) => names.has(source.entry)) : cited;
      const sourceText = isCandidate ? allowed.map((source) => source.text).join("\n") : employer;
      if (isCandidate && hasContradictoryClaimEvidence(sentence, sourceText)) {
        warnings.push(`Check conflicting candidate evidence for paragraph ${paragraphIndex + 1}.`);
      }
      const grounding = affirmativeEvidence(sourceText);
      const factualIssues = isCandidate ? coverLetterGroundingIssues({
        coverLetterText: sentence, jobText, grounding, resolved
      }) : [];
      issues.push(...factualIssues.map((issue) => ({ ...issue, paragraphIndex })));
      const conflict = (isCandidate
        ? hasUnsupportedOwnershipIncrease(sentence, grounding, grounding) ? "Unsupported ownership or responsibility" : null
        : candidateClaimIssue(sentence, sourceText, sourceText)) ||
        (isCandidate ? unsupportedAffiliation(sentence, grounding) : null);
      if (conflict && factualIssues.length === 0) {
        issues.push({
          code: isCandidate ? "unsupported_claim" : "unsupported_employer_claim",
          category: "evidence", recovery: isCandidate ? "add_evidence" : "retry",
          claim: sentence, paragraphIndex,
          detail: "This statement contains a factual claim absent from its cited source.",
          repairMessage: `Remove or correct the unsupported factual claim: ${conflict}. Preserve its source and attribution.`
        });
      } else if (isCandidate && names.size > 1) {
        warnings.push(`Check the attribution across the experiences cited in paragraph ${paragraphIndex + 1}.`);
      }
    }
  }
  return { issues, warnings: [...new Set(warnings)] };
}
