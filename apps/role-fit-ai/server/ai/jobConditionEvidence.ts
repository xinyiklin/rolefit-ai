import type { JobConditionIssue } from "../../shared/jobConditionContract.ts";
import { AUTH_STEMS, mentionsAuthStem } from "./eligibilityLexicon.ts";
import { distinctiveTokenKeys, LIST_STOPWORDS } from "./grounding.ts";

type PostingClause = { text: string; nonRequirementSection?: true };

function postingClauses(source: string): PostingClause[] {
  const clauses: PostingClause[] = [];
  let nonRequirementSection = false;
  for (const line of source.split(/\r?\n/)) {
    const clean = line.replace(/^\s*(?:[•·‣◦▪●○]|[-*–—](?=\s)|\d+[.)](?=\s))\s*/, "").trim();
    if (!clean) continue;
    if (/^(?:benefits|perks|our benefits|what we offer|compensation(?: and benefits)?|salary|total rewards|about (?:us|the company|our company)|how to apply|equal opportunity)(?:\s*:)?$/i.test(clean)) {
      nonRequirementSection = true;
      continue;
    }
    if (/^(?:about the (?:role|position|team)|the role|role overview|preferred qualifications|nice.to.have|preferred|bonus|required qualifications|requirements|qualifications|minimum qualifications|you have|responsibilities|duties|what you.ll do)(?:\s*:)?$/i.test(clean)) {
      nonRequirementSection = false;
      continue;
    }
    for (const { segment } of new Intl.Segmenter("en", { granularity: "sentence" }).segment(
      clean
    )) {
      const text = segment.trim();
      clauses.push({ text, ...(nonRequirementSection ? { nonRequirementSection: true as const } : {}) });
    }
  }
  return clauses;
}

const canonical = (text: string) =>
  text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?:]$/, "")
    .trim();

export function groundedJobCondition(
  value: string,
  field: JobConditionIssue["field"],
  source: string,
  issues: JobConditionIssue[]
): string {
  if (!value.trim()) return "";
  const words = distinctiveTokenKeys(value, LIST_STOPWORDS);
  const clauses = postingClauses(source).filter(
    (clause) =>
      field !== "workAuth" ||
      AUTH_STEMS.some((stem) => mentionsAuthStem(clause.text.toLowerCase(), stem))
  );
  const ranked = clauses
    .map((clause) => {
      const keys = new Set(distinctiveTokenKeys(clause.text, LIST_STOPWORDS));
      const overlap = words.filter((word) => keys.has(word)).length;
      return {
        clause,
        score: canonical(clause.text) === canonical(value) ? 2 : overlap / Math.max(words.length, 1)
      };
    })
    .sort((a, b) => b.score - a.score);
  const candidate = ranked[0];
  if (!candidate || candidate.score < 0.5) return "";
  const { clause } = candidate;
  const headingConcern = field !== "workAuth" && clause.nonRequirementSection;
  const qualificationConcern = field === "requiredQualifications" && /\bpreferred\b/i.test(clause.text);
  const preserveCondition = field === "workAuth" || /\b(?:not|no|never|unless|except|only|either|or|must|required|preferred|minimum|at least|at most)\b|\d/i.test(clause.text);
  const tooLong = preserveCondition && clause.text.length > (field === "workAuth" ? 240 : 1000);
  if (qualificationConcern || headingConcern || tooLong || (preserveCondition && canonical(value) !== canonical(clause.text))) {
    if (issues.length < 8) issues.push({
      field,
      sourceExcerpt: clause.text.slice(0, 1000),
      reason: qualificationConcern
        ? "Check this classification against the posting; the source describes this qualification as preferred."
        : headingConcern
          ? "Check this classification against the posting; its section heading suggests non-requirement content."
          : tooLong
            ? "This condition is too long to safely summarize. Review the original wording."
            : "The original condition was retained to preserve its meaning."
    });
  }
  return tooLong ? "" : preserveCondition ? clause.text : value;
}
