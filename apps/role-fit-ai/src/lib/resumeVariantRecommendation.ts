import { extractKeywords, includesKeyword } from "../resume/keywords.ts";

export type ResumeVariantCandidate = {
  fileName: string;
  label: string;
  text: string;
};

export type ResumeVariantRecommendationConfidence = "high" | "medium" | "low";

export type ResumeVariantRecommendation = {
  fileName: string;
  label: string;
  confidence: ResumeVariantRecommendationConfidence;
  matchedKeywords: string[];
  totalKeywords: number;
  lead: number;
  detail: string;
};

type RankedCandidate = ResumeVariantCandidate & {
  matchedKeywords: string[];
  coverage: number;
};

export function recommendResumeVariant(
  jobText: string,
  candidates: ResumeVariantCandidate[],
  expectedCandidateCount = candidates.length
): ResumeVariantRecommendation | null {
  const usable = candidates.filter((candidate) => candidate.fileName && candidate.text.trim().length >= 80);
  if (!usable.length) return null;
  const comparisonComplete = expectedCandidateCount >= 2 && usable.length === expectedCandidateCount;

  const keywords = extractKeywords(jobText, 24);
  const ranked: RankedCandidate[] = usable
    .map((candidate) => {
      const matchedKeywords = keywords.filter((keyword) => includesKeyword(candidate.text, keyword));
      return {
        ...candidate,
        matchedKeywords,
        coverage: keywords.length ? matchedKeywords.length / keywords.length : 0
      };
    })
    .sort(
      (left, right) =>
        right.matchedKeywords.length - left.matchedKeywords.length ||
        right.coverage - left.coverage ||
        left.label.localeCompare(right.label)
    );

  const best = ranked[0];
  const runnerUp = ranked[1];
  const lead = best.matchedKeywords.length - (runnerUp?.matchedKeywords.length ?? 0);
  const confidence: ResumeVariantRecommendationConfidence =
    comparisonComplete && keywords.length >= 5 && best.matchedKeywords.length >= 5 && best.coverage >= 0.38 && lead >= 2
      ? "high"
      : comparisonComplete &&
          keywords.length >= 3 &&
          best.matchedKeywords.length >= 3 &&
          best.coverage >= 0.25 &&
          lead >= 1
        ? "medium"
        : "low";

  const coverageDetail = keywords.length
    ? `Matches ${best.matchedKeywords.length} of ${keywords.length} prepared-job keywords`
    : "The prepared job did not expose enough keywords to compare reliably";
  const leadDetail = runnerUp
    ? lead > 0
      ? `, ${lead} more than ${runnerUp.label}`
      : `; tied with ${runnerUp.label}`
    : "";
  const completenessDetail = comparisonComplete
    ? ""
    : ` Comparison incomplete: checked ${usable.length} of ${expectedCandidateCount} expected variants, so automatic selection was withheld.`;

  return {
    fileName: best.fileName,
    label: best.label,
    confidence,
    matchedKeywords: best.matchedKeywords,
    totalKeywords: keywords.length,
    lead,
    detail: `${coverageDetail}${leadDetail}.${completenessDetail}`
  };
}
