// Pure scoring for the Prepare benchmark: extraction expectations over the
// sanitized job fields, automatic-Polish decisions per threshold, and small
// latency summaries. No provider, no file I/O, so the offline contract can
// probe every rule.
import { AUTO_POLISH_THRESHOLD_OPTIONS, fitAssessmentMeetsThreshold } from "../../../../src/lib/autoPolishPolicy.ts";

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whole-word match; a trailing "*" accepts any word ending. An all-capitals
// term (REST, CI, SQL) is an acronym and matches case-sensitively so "rest"
// and "decision" never count; everything else is case-insensitive. A term may
// be an any-of array for faithful paraphrases ("four*" or "4").
export function hasTerm(text, term) {
  if (Array.isArray(term)) return term.some((option) => hasTerm(text, option));
  const prefix = term.endsWith("*");
  const core = prefix ? term.slice(0, -1) : term;
  const lead = /^\w/.test(core) ? "\\b" : "";
  const tail = prefix || !/\w$/.test(core) ? "" : "\\b";
  const acronym = /^[A-Z]{2,}$/.test(core);
  return new RegExp(`${lead}${escape(core)}${tail}`, acronym ? "" : "i").test(String(text ?? ""));
}

const list = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
const LISTS = ["responsibilities", "requiredQualifications", "preferredQualifications", "techKeywords"];
// Where an invented term counts as fabrication: every list plus the fields an
// embedded instruction would try to rewrite.
const FABRICATION_FIELDS = [...LISTS, "title", "location", "workAuth"];

// Each check is a fraction of its own expectations; `score` averages the
// checks the fixture declares, and `fabricated` is reported separately because
// one invented requirement outweighs any coverage.
export function scoreJobFields(expected, fields) {
  const required = list(fields?.requiredQualifications);
  const preferred = list(fields?.preferredQualifications);
  const requiredText = [...list(fields?.responsibilities), ...required].join("\n");
  const techText = list(fields?.techKeywords).join("\n");
  const preferredText = preferred.join("\n");
  const fabricationText = FABRICATION_FIELDS.flatMap((key) => (key === "title" || key === "location" || key === "workAuth" ? [String(fields?.[key] ?? "")] : list(fields?.[key]))).join("\n");
  const checks = {};
  const fraction = (name, matched, total) => {
    if (total) checks[name] = { matched, total };
  };
  // A required term counts in the duties or required list, or in the tech
  // stack when it was not demoted to preferred.
  const missingRequired = (expected.requiredTerms ?? []).filter((term) =>
    !(hasTerm(requiredText, term) || (hasTerm(techText, term) && !hasTerm(preferredText, term))));
  fraction("requiredCoverage", (expected.requiredTerms ?? []).length - missingRequired.length, (expected.requiredTerms ?? []).length);
  const misplacedPreferred = (expected.preferredTerms ?? []).filter((term) => !hasTerm(preferredText, term) || hasTerm(required.join("\n"), term));
  fraction("preferredPlacement", (expected.preferredTerms ?? []).length - misplacedPreferred.length, (expected.preferredTerms ?? []).length);
  const lostAlternatives = (expected.alternatives ?? []).filter((terms) =>
    ![...required, ...preferred].some((item) => terms.every((term) => hasTerm(item, term))));
  fraction("alternativesPreserved", (expected.alternatives ?? []).length - lostAlternatives.length, (expected.alternatives ?? []).length);
  const missingEligibility = (expected.eligibilityTerms ?? []).filter((term) => !hasTerm(fields?.workAuth, term));
  fraction("eligibilityCaptured", (expected.eligibilityTerms ?? []).length - missingEligibility.length, (expected.eligibilityTerms ?? []).length);
  const filledLists = (expected.emptyLists ?? []).filter((key) => list(fields?.[key]).length > 0);
  fraction("emptyListsKept", (expected.emptyLists ?? []).length - filledLists.length, (expected.emptyLists ?? []).length);
  const identity = {};
  for (const key of ["title", "company", "location"]) {
    if (expected[key]) identity[key] = hasTerm(fields?.[key], expected[key]);
  }
  if (expected.jobType) identity.jobType = String(fields?.jobType ?? "") === expected.jobType;
  if (expected.salary) {
    identity.salary = Object.entries(expected.salary).every(([key, value]) => fields?.[key] === value);
  }
  const identityValues = Object.values(identity);
  fraction("identity", identityValues.filter(Boolean).length, identityValues.length);
  const fabricated = (expected.absentTerms ?? []).filter((term) => hasTerm(fabricationText, term));
  const fractions = Object.values(checks).map((check) => check.matched / check.total);
  return {
    checks,
    identity,
    missing: { required: missingRequired, preferred: misplacedPreferred, alternatives: lostAlternatives, eligibility: missingEligibility, emptyLists: filledLists },
    fabricated,
    score: fractions.length ? Number((fractions.reduce((sum, value) => sum + value, 0) / fractions.length).toFixed(3)) : null
  };
}

export const THRESHOLDS = AUTO_POLISH_THRESHOLD_OPTIONS.map((option) => option.value);

// What automatic Polish would do with this Fit result under each threshold.
// An insufficient-information or missing result never starts Polish, and the
// app declines automation whenever eligibility is BLOCKED whatever the verdict.
export function automationDecisions(result) {
  const blocked = result?.eligibility?.status === "BLOCKED";
  const verdict = !blocked && (result?.status === "ASSESSED" || (result && !result.status && result.verdict)) ? result.verdict : undefined;
  return Object.fromEntries(THRESHOLDS.map((threshold) => [threshold, fitAssessmentMeetsThreshold(verdict, threshold)]));
}

// Thresholds on which the supplied decisions disagree.
export function decisionFlips(decisionsList) {
  return THRESHOLDS.filter((threshold) => new Set(decisionsList.map((decisions) => decisions[threshold])).size > 1);
}

export function quantiles(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return { n: 0, min: null, median: null, p90: null, max: null };
  const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
  return { n: sorted.length, min: sorted[0], median: at(0.5), p90: at(0.9), max: sorted[sorted.length - 1] };
}

// Sums usage across dispatches; a field any dispatch could not report is null.
export function sumUsage(usages) {
  if (!usages.length || usages.some((usage) => !usage)) return null;
  const keys = ["inputTokens", "cachedInputTokens", "cacheCreationInputTokens", "outputTokens", "totalTokens", "costUsd"];
  return Object.fromEntries(keys.map((key) => [key, usages.some((usage) => usage[key] === null) ? null : usages.reduce((sum, usage) => sum + usage[key], 0)]));
}
