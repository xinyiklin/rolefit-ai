// Probes for src/lib/candidateFacts.ts — buildCandidateFactsContext() output
// feeds the AI request's honestContext, which the server folds into the
// keyword-grounding allowlist (server/ai/sanitize.ts). "unspecified" MUST stay
// the neutral default (asserts nothing) and every concrete line MUST match the
// exact wording the sanitizer/model sees. mergeHonestContext's ordering is
// load-bearing too: candidate facts lead, freeform honest context follows.
//
//   node src/lib/__evals__/candidate-facts-eval.mjs

import assert from "node:assert/strict";

import {
  buildCandidateFactsContext,
  mergeHonestContext,
  normalizeAvailabilityDate,
  normalizeCandidateGpa,
  normalizeCandidateExperience
} from "../candidateFacts.ts";

const base = { citizenshipStatus: "unspecified", legallyAuthorizedToWork: false, requiresSponsorship: false };

// ── "unspecified" default asserts nothing ───────────────────────────────────
assert.equal(
  buildCandidateFactsContext(base),
  "",
  "unspecified citizenship (the neutral default) returns empty context regardless of the other two flags"
);
assert.equal(
  buildCandidateFactsContext({ ...base, legallyAuthorizedToWork: true, requiresSponsorship: true }),
  "",
  "unspecified citizenship stays the gate even when auth/sponsorship flags are set"
);

// ── Every citizenship line, verbatim ────────────────────────────────────────
assert.equal(
  buildCandidateFactsContext({ citizenshipStatus: "us-citizen", legallyAuthorizedToWork: true, requiresSponsorship: false }),
  "Candidate facts:\n" +
    "- Citizenship: U.S. citizen; eligible for security clearances and positions requiring U.S. citizenship.\n" +
    "- Work authorization: legally authorized to work in the United States.\n" +
    "- Visa sponsorship: does not require employer visa sponsorship now or in the future.",
  "us-citizen line matches the exact grounding text verbatim"
);
assert.equal(
  buildCandidateFactsContext({ citizenshipStatus: "permanent-resident", legallyAuthorizedToWork: true, requiresSponsorship: false }),
  "Candidate facts:\n" +
    "- Citizenship: U.S. permanent resident (green card holder); authorized to work, but not eligible for positions requiring U.S. citizenship or security clearances.\n" +
    "- Work authorization: legally authorized to work in the United States.\n" +
    "- Visa sponsorship: does not require employer visa sponsorship now or in the future.",
  "permanent-resident line matches the exact grounding text verbatim"
);
assert.equal(
  buildCandidateFactsContext({ citizenshipStatus: "foreign-national", legallyAuthorizedToWork: false, requiresSponsorship: true }),
  "Candidate facts:\n" +
    "- Citizenship: foreign national; not a U.S. citizen or permanent resident.\n" +
    "- Work authorization: not currently authorized to work in the United States.\n" +
    "- Visa sponsorship: will require employer visa sponsorship now or in the future.",
  "foreign-national line matches the exact grounding text verbatim"
);

// ── Work-auth / sponsorship booleans flip independently of citizenship ─────
assert.match(
  buildCandidateFactsContext({ citizenshipStatus: "foreign-national", legallyAuthorizedToWork: true, requiresSponsorship: false }),
  /- Work authorization: legally authorized to work in the United States\.\n- Visa sponsorship: does not require employer visa sponsorship now or in the future\.$/,
  "authorized + no-sponsorship combination renders the affirmative pair"
);
assert.match(
  buildCandidateFactsContext({ citizenshipStatus: "foreign-national", legallyAuthorizedToWork: false, requiresSponsorship: true }),
  /- Work authorization: not currently authorized to work in the United States\.\n- Visa sponsorship: will require employer visa sponsorship now or in the future\.$/,
  "not-authorized + requires-sponsorship combination renders the negative pair"
);

// ── mergeHonestContext precedence: candidate facts first, then honest context ─
assert.equal(
  mergeHonestContext("Freeform notes about my background.", "Candidate facts:\n- Citizenship: U.S. citizen."),
  "Candidate facts:\n- Citizenship: U.S. citizen.\n\nFreeform notes about my background.",
  "candidate facts always lead, freeform honestContext always follows, joined by a blank line"
);
assert.equal(
  mergeHonestContext("", "Candidate facts:\n- Citizenship: U.S. citizen."),
  "Candidate facts:\n- Citizenship: U.S. citizen.",
  "empty honestContext leaves just the candidate-facts block, no trailing separator"
);
assert.equal(
  mergeHonestContext("Freeform notes.", ""),
  "Freeform notes.",
  "empty candidateFactsContext (unspecified citizenship) leaves just the freeform honestContext"
);
assert.equal(mergeHonestContext("", ""), "", "both empty merges to empty");
assert.equal(mergeHonestContext("   ", "   "), "", "whitespace-only inputs trim to empty on both sides");
assert.equal(
  mergeHonestContext("  leading/trailing space  ", "  candidate block  "),
  "candidate block\n\nleading/trailing space",
  "each side is trimmed before joining"
);

// ── Malformed / defensive inputs ────────────────────────────────────────────
// A citizenshipStatus outside the known union (e.g. corrupted storage that
// bypassed settings.ts's normalizeSettings validation) must fail closed. The
// authorization booleans belong to the same declared block and cannot survive
// an invalid or missing gate as standalone claims.
assert.equal(
  buildCandidateFactsContext({ citizenshipStatus: "bogus-status", legallyAuthorizedToWork: true, requiresSponsorship: false }),
  "",
  "an out-of-union citizenshipStatus emits no citizenship, authorization, or sponsorship claims"
);
// Missing/undefined booleans are falsy in the ternaries, so they read as the
// negative branch rather than throwing.
assert.match(
  buildCandidateFactsContext({ citizenshipStatus: "us-citizen" }),
  /- Work authorization: not currently authorized to work in the United States\.\n- Visa sponsorship: does not require employer visa sponsorship now or in the future\.$/,
  "missing legallyAuthorizedToWork/requiresSponsorship booleans read as the negative branch, never throw"
);
assert.equal(
  buildCandidateFactsContext({}),
  "",
  "an entirely empty facts object emits no claims"
);
assert.equal(
  buildCandidateFactsContext({ citizenshipStatus: "", legallyAuthorizedToWork: true, requiresSponsorship: false }),
  "",
  "an empty persisted citizenship value cannot assert authorization or sponsorship facts"
);

// ── Education: an independent opt-in, positively gated ──────────────────────
// A degree is one of the easiest things for a resume model to invent, so the
// education block emits ONLY for a level that maps to a known line. That is
// stricter than the citizenship gate above (which only checks the literal
// "unspecified"), and it means an absent, undefined, or corrupted level cannot
// let a bare field of study through as an implied credential.
assert.equal(
  buildCandidateFactsContext({ ...base, educationLevel: "unspecified", major: "Mechanical Engineering" }),
  "",
  "an unspecified education level emits nothing, even with a field of study set"
);
assert.equal(
  buildCandidateFactsContext({ ...base, educationLevel: "bogus-level", major: "Mechanical Engineering" }),
  "",
  "an out-of-union education level emits nothing — no bare field of study, no implied credential"
);
assert.equal(
  buildCandidateFactsContext({ ...base, major: "Mechanical Engineering" }),
  "",
  "a field of study with NO level at all emits nothing"
);
assert.equal(
  buildCandidateFactsContext({ ...base, educationLevel: "bachelor" }),
  "Candidate facts:\n- Education: highest completed level is a bachelor's degree.",
  "a declared level alone renders without a field of study, and without any citizenship line"
);
assert.equal(
  buildCandidateFactsContext({ ...base, educationLevel: "bachelor", major: "  Mechanical Engineering  " }),
  "Candidate facts:\n" +
    "- Education: highest completed level is a bachelor's degree.\n" +
    "- Field of study: Mechanical Engineering.",
  "a declared level plus a field of study renders both lines, with the major trimmed"
);
assert.equal(
  buildCandidateFactsContext({ ...base, educationLevel: "bachelor", major: "   " }),
  "Candidate facts:\n- Education: highest completed level is a bachelor's degree.",
  "a whitespace-only field of study contributes no line"
);
for (const [level, expected] of [
  ["high-school", "highest completed level is a high school diploma or GED."],
  ["associate", "highest completed level is an associate degree."],
  ["bachelor", "highest completed level is a bachelor's degree."],
  ["master", "highest completed level is a master's degree."],
  ["doctorate", "highest completed level is a doctorate (PhD)."],
  ["professional", "highest completed level is a professional degree (for example JD or MD)."]
]) {
  assert.equal(
    buildCandidateFactsContext({ ...base, educationLevel: level, major: "" }),
    `Candidate facts:\n- Education: ${expected}`,
    `the ${level} line matches the exact grounding text verbatim`
  );
}
// The major is capped because it reaches a prompt.
assert.equal(
  buildCandidateFactsContext({ ...base, educationLevel: "bachelor", major: "x".repeat(200) }),
  `Candidate facts:\n- Education: highest completed level is a bachelor's degree.\n- Field of study: ${"x".repeat(120)}.`,
  "an over-long field of study is truncated to MAJOR_MAX_LENGTH"
);

// GPA is declared only with a known education level and an explicit supported
// scale. Invalid, incomplete, or over-scale values assert nothing.
assert.equal(
  buildCandidateFactsContext({
    ...base,
    educationLevel: "bachelor",
    major: "Computer Science",
    gpa: 3.86
  }),
  "Candidate facts:\n" +
    "- Education: highest completed level is a bachelor's degree.\n" +
    "- Field of study: Computer Science.\n" +
    "- GPA: 3.86 on a 4.0 scale.",
  "a declared GPA stays attached to the declared education block and names its scale"
);
assert.equal(
  buildCandidateFactsContext({ ...base, gpa: 3.8 }),
  "",
  "GPA without a declared education level does not imply a credential"
);
assert.equal(normalizeCandidateGpa(4.5), null, "GPA above the 4.0 scale is rejected");
assert.equal(normalizeCandidateGpa(3.899), 3.9, "GPA is bounded to two decimals");

// Availability is independent scheduling context. Relative notice and valid
// dates emit exact factual lines; malformed calendar dates emit nothing.
for (const [notice, expected] of [
  ["immediately", "can start immediately."],
  ["one-week", "can start after one week of notice."],
  ["two-weeks", "can start after two weeks of notice."],
  ["three-weeks", "can start after three weeks of notice."],
  ["four-weeks", "can start after four weeks of notice."]
]) {
  assert.equal(
    buildCandidateFactsContext({ ...base, availabilityNotice: notice }),
    `Candidate facts:\n- Availability: ${expected}`,
    `${notice} emits its bounded availability wording`
  );
}
assert.equal(
  buildCandidateFactsContext({
    ...base,
    availabilityNotice: "specific-date",
    availabilityDate: "2026-09-14"
  }),
  "Candidate facts:\n- Availability: earliest available start date is 2026-09-14.",
  "a valid specific date is preserved without locale ambiguity"
);
assert.equal(normalizeAvailabilityDate("2026-02-31"), undefined, "an impossible calendar date is rejected");
assert.equal(
  buildCandidateFactsContext({
    ...base,
    availabilityNotice: "specific-date",
    availabilityDate: "2026-02-31"
  }),
  "",
  "an invalid specific date asserts no availability fact"
);

// ── The two blocks are independent opt-ins ──────────────────────────────────
// Citizenship no longer short-circuits the whole function: declaring one block
// must neither require nor suppress the other.
assert.equal(
  buildCandidateFactsContext({
    citizenshipStatus: "us-citizen",
    legallyAuthorizedToWork: true,
    requiresSponsorship: false,
    educationLevel: "master",
    major: "Statistics"
  }),
  "Candidate facts:\n" +
    "- Citizenship: U.S. citizen; eligible for security clearances and positions requiring U.S. citizenship.\n" +
    "- Work authorization: legally authorized to work in the United States.\n" +
    "- Visa sponsorship: does not require employer visa sponsorship now or in the future.\n" +
    "- Education: highest completed level is a master's degree.\n" +
    "- Field of study: Statistics.",
  "both blocks declared: citizenship trio first, then education pair, in one Candidate facts list"
);
assert.match(
  buildCandidateFactsContext({ ...base, educationLevel: "doctorate" }),
  /^Candidate facts:\n- Education:/,
  "education renders with NO citizenship declared — it is not gated behind citizenship"
);

// ── Experience evidence: source, quantity, recency, and scope ───────────────
const experienceOnly = buildCandidateFactsContext({
  ...base,
  experienceProfile: [
    { category: "personal", count: 4, mostRecentYear: 2026, details: "browser extensions and local-first tools" },
    { category: "professional", years: 2.5, count: 2, details: "production TypeScript and PostgreSQL services" },
    { category: "academic", years: 1, count: 1 }
  ]
});
assert.equal(
  experienceOnly,
  "Candidate facts:\n" +
    "- Experience inventory: candidate-declared evidence sources; determine relevance to this posting and do not add durations or counts across categories because entries may overlap.\n" +
    "- Professional employment: 2.5 years; 2 roles or projects; scope: production TypeScript and PostgreSQL services.\n" +
    "- Academic / coursework projects: 1 year; 1 role or project.\n" +
    "- Personal / independent projects: 4 roles or projects; most recent in 2026; scope: browser extensions and local-first tools.",
  "experience renders in the canonical evidence-source order and explicitly prevents overlap from becoming inflated total experience"
);

assert.deepEqual(
  normalizeCandidateExperience([
    { category: "professional", years: 200, count: 0, mostRecentYear: 2200, details: `  ${"x".repeat(300)}  `, extra: true },
    { category: "professional", years: 3 },
    { category: "bogus", years: 4 },
    null
  ]),
  [{
    category: "professional",
    details: "x".repeat(240)
  }],
  "experience normalization drops out-of-range quantities, caps prompt text, drops unknown categories, and keeps one record per category"
);

assert.equal(
  buildCandidateFactsContext({ ...base, experienceProfile: [{ category: "research" }] }),
  "Candidate facts:\n" +
    "- Experience inventory: candidate-declared evidence sources; determine relevance to this posting and do not add durations or counts across categories because entries may overlap.\n" +
    "- Research / lab: category declared without a quantity.",
  "selecting a category alone declares its existence without inventing duration, count, recency, or scope"
);

console.log("candidate-facts probes passed");
