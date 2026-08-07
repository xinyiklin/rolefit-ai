import { extractKeywords, includesKeyword } from "../resume/keywords.ts";

// One ranker serves both saved document kinds: resume variants and cover-letter
// variants are both "which saved source best matches this prepared role".
export type VariantCandidate = {
  fileName: string;
  label: string;
  text: string;
};

export type VariantRecommendation = {
  fileName: string;
  label: string;
  matchedKeywords: string[];
  totalKeywords: number;
  lead: number;
};

type RankedCandidate = VariantCandidate & {
  matchedKeywords: string[];
  matchWeight: number;
};

const SECTION_WEIGHTS = new Map([
  ["job title", 6],
  ["required qualifications", 5],
  ["tech stack / keywords", 4],
  ["core responsibilities", 3],
  ["seniority signals", 3],
  ["domain signals", 2.5],
  ["preferred qualifications", 2],
  ["company / product context", 1]
]);

function weightedJobKeywords(jobText: string): Map<string, number> {
  const weights = new Map<string, number>();
  for (const keyword of extractKeywords(jobText, 32)) {
    weights.set(keyword, 1);
  }

  let activeHeading = "";
  const sections = new Map<string, string[]>();
  for (const rawLine of jobText.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    const normalizedHeading = line.replace(/:\s*$/, "").toLowerCase();
    if (SECTION_WEIGHTS.has(normalizedHeading)) {
      activeHeading = normalizedHeading;
      sections.set(activeHeading, []);
      continue;
    }
    if (
      activeHeading &&
      line &&
      !/^\[(?:manual input needed|not specified)[^\]]*\]$|^not specified$/i.test(
        line.replace(/^\s*[-*]\s*/, "")
      )
    ) {
      sections.get(activeHeading)?.push(line);
    }
  }

  for (const [heading, lines] of sections) {
    const sectionWeight = SECTION_WEIGHTS.get(heading) ?? 1;
    for (const keyword of extractKeywords(lines.join("\n"), 16)) {
      weights.set(keyword, Math.max(weights.get(keyword) ?? 0, sectionWeight));
    }
  }
  return weights;
}

export function recommendVariant(
  jobText: string,
  candidates: VariantCandidate[],
  expectedCandidateCount = candidates.length,
  // A resume that short is a stub; a one-paragraph cover letter is not, so each
  // caller states the length below which its own documents cannot be compared.
  minimumTextLength = 80
): VariantRecommendation | null {
  const usable = candidates.filter(
    (candidate) => candidate.fileName && candidate.text.trim().length >= minimumTextLength
  );
  const comparisonComplete = expectedCandidateCount >= 2 && usable.length === expectedCandidateCount;
  if (!comparisonComplete) return null;

  const keywordWeights = weightedJobKeywords(jobText);
  const keywords = [...keywordWeights.keys()];
  const totalWeight = [...keywordWeights.values()].reduce((sum, weight) => sum + weight, 0);
  const ranked: RankedCandidate[] = usable
    .map((candidate) => {
      const matchedKeywords = keywords.filter((keyword) => includesKeyword(candidate.text, keyword));
      const matchWeight = matchedKeywords.reduce(
        (sum, keyword) => sum + (keywordWeights.get(keyword) ?? 0),
        0
      );
      return {
        ...candidate,
        matchedKeywords,
        matchWeight
      };
    })
    .sort(
      (left, right) =>
        right.matchWeight - left.matchWeight ||
        right.matchedKeywords.length - left.matchedKeywords.length ||
        left.label.localeCompare(right.label)
    );

  const best = ranked[0];
  const runnerUp = ranked[1];
  if (!best || !runnerUp || !keywords.length) return null;
  const lead = best.matchWeight - runnerUp.matchWeight;
  // Do not turn alphabetical ordering or a negligible low-signal edge into a
  // recommendation. A recommendation must identify a meaningfully better source.
  const minimumLead = Math.max(1.5, totalWeight * 0.02);
  if (best.matchWeight <= 0 || lead < minimumLead) return null;

  return {
    fileName: best.fileName,
    label: best.label,
    matchedKeywords: best.matchedKeywords,
    totalKeywords: keywords.length,
    lead
  };
}
