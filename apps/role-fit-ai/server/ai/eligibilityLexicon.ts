// ELIGIBILITY LEXICON — the one home for every work-auth / credential-gate term
// list, so a new gate (e.g. "work permit", "right to work", "US person",
// "SC-DV") is added HERE and every consumer is considered together. The three
// artifacts below are deliberately NOT one merged list: each serves a different
// judgment with different false-positive costs, and their documented deltas are
// load-bearing. When adding a term, decide for each artifact separately:
//
//   1. AUTH_STEMS (+ mentionsAuthStem)     — distill grounding: may the model's
//      workAuth field mention this? Includes "ead"/"naturaliz" because the
//      matcher is boundary-anchored (see below), so short stems are safe here.
//   2. ELIGIBILITY_BLOCKER                 — scoring hard gate: does a missing
//      critical/high row force DON'T APPLY? Adds license/licence/certif/degree
//      (credentials you can't gain by rephrasing); deliberately EXCLUDES bare
//      "ead" (collides with Exposure At Default, a finance metric) and bare
//      year/senior/level (a missing "5+ years" is a HIGH gap, never a blocker).
//   3. SENIORITY_BUCKET_RE                 — scoring bucketing: which coverage
//      rows land in the "seniority" scoring bucket. Superset direction: ADDS
//      year/senior/level (true seniority signals) on top of the credential
//      gates, and drops the phrase-level gates (polygraph/ts/sci/green card/
//      permanent resident/eligible-to-work) that appear in requirement TEXT
//      rather than category labels. A gate term missing here can silently drop
//      that row from scoring entirely (coverageHasEligibilityBlocker scans raw
//      rows precisely to survive that) — so check this list on every addition.

// Work-auth stems the distiller may keep in a grounded workAuth field. Consumed
// by groundedWorkAuth (distill.ts): the model's value must name one of these AND
// the same stem must appear in the source posting, else the field is dropped as
// invented.
export const AUTH_STEMS = [
  "clearance", "citizen", "visa", "sponsor", "authoriz", "authoris",
  "green card", "permanent resident", "eligible to work", "work auth",
  "polygraph", "ts/sci", "naturaliz", "ead"
];

// Whole-word-START match for an auth stem: the stem must begin at a non-
// alphanumeric boundary, but any SUFFIX is allowed. The boundary stops a short
// stem from matching mid-word ("ead" must NOT match inside lead/read/ahead/
// deadline — a substring check kept an invented "EAD required" on nearly every
// posting and misclassified "Lead engineer, ready to start" as an auth
// statement), while the open suffix keeps same-concept inflections grounding
// (sponsor→sponsorship, authoriz→authorization, citizen→citizenship). Mirrors
// groundedTech's boundary discipline.
export function mentionsAuthStem(text: string, stem: string): boolean {
  const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(String.raw`(?:^|[^a-z0-9])${esc}`, "i").test(text);
}

// The HARD eligibility gates (clearance / work-auth / residency / license /
// cert / degree) that force a DON'T APPLY when a JD requires one the candidate
// lacks. Deliberately EXCLUDES bare year/senior/level — a missing "5+ years" is
// a HIGH gap at most, never a hard blocker. Terms are chosen to avoid substring
// FALSE POSITIVES on a critical/high MISSING row (each would wrongly tell the
// user NOT to apply to a role they qualify for): "authorization"/"authorisation"
// stay FULL words (so "unauthorized access", a security SKILL, never fires),
// with an explicit "...to work" phrase catching the standalone
// "authorized/eligible to work"; "green card" takes a right boundary (rejects
// "cardigan"); "permanent resid(ent|ency|ence)" rejects "residual" (an ML
// term). The bare "EAD" abbreviation is deliberately NOT matched — it collides
// with the finance/risk metric Exposure At Default (EAD/PD/LGD); the
// spelled-out "employment authorization document" is already caught by
// "authorization". Only fires under coverageHasEligibilityBlocker's
// critical/high + still-missing guard (scoring.ts). Under-coverage is the safe
// direction; missed gates (work permit / right to work / US person / SC-DV)
// are a deliberate lexicon follow-up.
export const ELIGIBILITY_BLOCKER =
  /clearance|citizen|authorization|authorisation|sponsor|visa|license|licence|certif|degree|\bgreen\s*cards?\b|permanent\s+resid(?:ent|ency|ence)\b|polygraph|ts\/sci|(?:eligible|authoriz\w+|authoris\w+)\s+to\s+work/i;

// Category-label test that buckets a requirementCoverage row into the
// "seniority" scoring bucket (requirementBucket, scoring.ts). See the header
// for how this list deliberately differs from the two above.
export const SENIORITY_BUCKET_RE =
  /\byear|senior|level|degree|certif|clearance|citizen|authorization|authorisation|sponsor|visa|license|licence\b/;
