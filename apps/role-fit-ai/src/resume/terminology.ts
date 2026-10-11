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

export type TerminologyCoverage = {
  onResume: JobTerm[];
  relatedOnly: JobTerm[];
  notOnResume: JobTerm[];
  limitations: string[];
};

// Which of the posting's recognized terms the resume uses, by the same matching
// Polish uses: an affirmative mention or true alias is On resume; a related term
// alone, or a denied mention, is not. Advisory only: no score, no coverage claim.
export function terminologyCoverage(jobText: string, resumeText: string): TerminologyCoverage {
  const { terms, limitations } = jobTerminology(jobText);
  const coverage: TerminologyCoverage = { onResume: [], relatedOnly: [], notOnResume: [], limitations };
  for (const term of terms) {
    if (affirmativeTerm(resumeText, term.keyword)) coverage.onResume.push(term);
    else if (terminologyMatch(resumeText, term.keyword) === "related") coverage.relatedOnly.push(term);
    else coverage.notOnResume.push(term);
  }
  return coverage;
}

// Specific evidence entails its category: PostgreSQL is database work. Only that
// direction holds, a related tool never entails a practice (CI is not CI/CD), and a
// denied category stays unsupported. Names are case-sensitive to avoid common-word
// collisions; contrived ones (a colleague named Django) are accepted.
const ENTAILED_BY: Record<string, RegExp> = {
  database: /\b(?:PostgreSQL|Postgres|MySQL|MariaDB|SQLite|MongoDB|DynamoDB|Apache Cassandra)\b/g,
  frontend: /\b(?:React|Vue(?:\.js)?|Angular|Svelte|Next\.js)\b/g,
  backend: /\b(?:Node\.js|Express\.js|ExpressJS|Django|Flask|FastAPI|Spring Boot|NestJS)\b/g,
  "rest api": /\bDjango REST Framework\b/g,
  algorithms: /\balgorithmic\b/gi,
  cloud: /\b(?:AWS|Azure|GCP|Google Cloud)\b/g,
  python: /\b(?:Django|Flask|FastAPI|NumPy|PyTorch|pytest|scikit-learn)\b/g
};
// Line-initial "React to pages", "Angular momentum", or "Flask cultures" is not the tool.
const LINE_START_HOMONYMS = new Set(["React", "Vue", "Angular", "Flask"]);

function entailedTerm(evidence: string, keyword: string): boolean {
  const pattern = ENTAILED_BY[keyword];
  if (!pattern) return false;
  const segments = evidenceSegments(evidence);
  return !segments.some((segment) => evidencePolarity(segment) === "denied" && ["exact", "equivalent"].includes(terminologyMatch(segment, keyword)))
    && segments.some((segment) => evidencePolarity(segment) === "affirmative" && [...segment.matchAll(pattern)].some((match) =>
      !(LINE_START_HOMONYMS.has(match[0]) && /^[\s\u2022*-]*$/.test(segment.slice(0, match.index)))));
}

export function unsupportedTerminology(replacement: string, evidence: string, terms: JobTerm[]): string[] {
  return terms
    .filter(({ keyword }) => affirmativeTerm(replacement, keyword) && !affirmativeTerm(evidence, keyword) && !entailedTerm(evidence, keyword))
    .map(({ keyword }) => `${keyword}: not supported by provided evidence for this entry.`);
}

export function lostAcceptedTerms(snapshot: TerminologySnapshot | undefined, inputKey: string | undefined,
  currentText: string, accepted: Array<{ original: string; current: string }>,
  uncertain: Array<{ original: string; current: string }> = []): string[] {
  if (!snapshot || snapshot.inputKey !== inputKey) return [];
  return snapshot.terms.filter(({ keyword }) =>
    !affirmativeTerm(currentText, keyword)
    && !uncertain.some(({ original, current }) => affirmativeTerm(original, keyword) && affirmativeTerm(current, keyword))
    && accepted.some(({ original, current }) => affirmativeTerm(original, keyword) && !affirmativeTerm(current, keyword))
  ).map(({ keyword, category }) => `This accepted edit removes the last clear ${keyword} mention (${category} in the posting). Review whether to keep that supported term.`);
}
