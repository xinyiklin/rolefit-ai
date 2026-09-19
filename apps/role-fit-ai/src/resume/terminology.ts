import { evidencePolarity, evidenceSegments } from "../../shared/evidencePolarity.ts";
import { parseTailoringSections } from "../lib/preparedJobBrief.ts";
import { ROLE_KEYWORDS, terminologyMatch } from "./keywords.ts";

export type JobTerm = { keyword: string; phrase: string; category: "required" | "preferred" | "responsibility" | "technical" };
export type TerminologySnapshot = { inputKey: string; terms: JobTerm[]; limitations: string[] };

export function affirmativeTerm(text: string, keyword: string): boolean {
  const mentions = evidenceSegments(text).filter((segment) => ["exact", "equivalent"].includes(terminologyMatch(segment, keyword)));
  return mentions.some((segment) => evidencePolarity(segment) === "affirmative")
    && !mentions.some((segment) => evidencePolarity(segment) === "denied");
}

export function jobTerminology(jobText: string): { terms: JobTerm[]; limitations: string[] } {
  const brief = parseTailoringSections(jobText, Number.MAX_SAFE_INTEGER);
  const sections = [
    ["required", brief.requiredQualifications], ["responsibility", brief.responsibilities],
    ["technical", brief.techKeywords], ["preferred", brief.preferredQualifications]
  ] as const;
  const terms: JobTerm[] = [];
  const seen = new Set<string>();
  let unknown = false;
  for (const [category, lines] of sections) for (const phrase of lines) {
    const matches = ROLE_KEYWORDS.filter(({ keyword }) => ["exact", "equivalent"].includes(terminologyMatch(phrase, keyword)));
    if (!matches.length) unknown = true;
    for (const { keyword } of matches) {
      if (seen.has(keyword)) continue;
      seen.add(keyword);
      terms.push({ keyword, phrase, category });
    }
  }
  const limitations = ["Terminology checks cover recognized terms only; they do not assess every qualification."];
  if (!sections.some(([, lines]) => lines.length)) limitations.push("Required/preferred job sections were not available; terminology preservation was not assessed.");
  if (unknown) limitations.push("Some requirements contain terms outside the recognized catalog.");
  if (terms.length > 48) limitations.push("Additional terminology was omitted from this pass.");
  return { terms: terms.slice(0, 48), limitations };
}

export function unsupportedTerminology(replacement: string, evidence: string, jobText: string): string[] {
  return jobTerminology(jobText).terms
    .filter(({ keyword }) => affirmativeTerm(replacement, keyword) && !affirmativeTerm(evidence, keyword))
    .map(({ keyword }) => `${keyword}: not supported by provided evidence for this entry.`);
}

export function lostAcceptedTerms(snapshot: TerminologySnapshot | undefined, inputKey: string | undefined,
  currentText: string, accepted: Array<{ original: string; current: string }>): string[] {
  if (!snapshot || snapshot.inputKey !== inputKey) return [];
  return snapshot.terms.filter(({ keyword }) =>
    !affirmativeTerm(currentText, keyword)
    && accepted.some(({ original, current }) => affirmativeTerm(original, keyword) && !affirmativeTerm(current, keyword))
  ).map(({ keyword, category }) => `This accepted edit removes the last clear ${keyword} mention (${category} in the posting). Review whether to keep that supported term.`);
}
