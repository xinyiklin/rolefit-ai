// Probes for src/lib/candidateFacts.ts — buildCandidateFactsContext() output
// feeds the AI request's honestContext, which the server folds into the
// keyword-grounding allowlist (server/ai/sanitize.ts). "unspecified" MUST stay
// the neutral default (asserts nothing) and every concrete line MUST match the
// exact wording the sanitizer/model sees. mergeHonestContext's ordering is
// load-bearing too: candidate facts lead, freeform honest context follows.
//
//   node src/lib/__evals__/candidate-facts-eval.mjs

import assert from "node:assert/strict";

import { buildCandidateFactsContext, mergeHonestContext } from "../candidateFacts.ts";

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
// bypassed settings.ts's normalizeSettings validation) is not "unspecified", so
// it does NOT hit the early-return gate. The unrecognized status contributes no
// citizenship line (CITIZENSHIP_CONTEXT[...] is undefined and gets filtered),
// but the auth/sponsorship lines still render from the two booleans actually
// passed in — no fabricated citizenship claim, but the "citizenship gates the
// whole block" comment does not hold for this out-of-union input. Lock the
// current (defensive, non-crashing) behavior; real callers are protected
// upstream by settings.ts normalizeSettings before this ever runs.
assert.equal(
  buildCandidateFactsContext({ citizenshipStatus: "bogus-status", legallyAuthorizedToWork: true, requiresSponsorship: false }),
  "Candidate facts:\n" +
    "- Work authorization: legally authorized to work in the United States.\n" +
    "- Visa sponsorship: does not require employer visa sponsorship now or in the future.",
  "an out-of-union citizenshipStatus drops the (unknown) citizenship line but still renders the two boolean-derived lines without inventing a citizenship claim"
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
  "Candidate facts:\n" +
    "- Work authorization: not currently authorized to work in the United States.\n" +
    "- Visa sponsorship: does not require employer visa sponsorship now or in the future.",
  "an entirely empty facts object: citizenshipStatus (undefined) !== the literal 'unspecified' string, so the early-return gate is NOT hit — the citizenship line drops (undefined, filtered) but both negative boolean lines still render. Lock this: only the literal string 'unspecified' gates the block, not any other falsy/absent value."
);

console.log("candidate-facts probes passed");
