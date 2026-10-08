import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { classifyEligibilityExcerpt, suggestSkipReasons } from "../skipReasonSuggestions.ts";
import { formatNotApplyingReasons, normalizeNotApplyingReasons } from "../notApplying.ts";

// Skip suggestions are local evidence only. A prior decision on the same posting
// is the sole pre-check when present; otherwise strong evidence (a submitted
// linked application, a Blocked eligibility condition) is pre-checked and weak
// evidence is only marked. Synthetic fixtures only.

const fit = (overrides = {}) => ({
  status: "ASSESSED",
  verdict: "STRONG",
  summary: "Synthetic summary.",
  matches: [],
  gaps: [],
  ...overrides
});
const record = (overrides = {}) => ({
  id: "record-1",
  title: "Engineer at Example",
  status: "applied",
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-01T12:00:00.000Z",
  appliedAt: "2026-08-02T12:00:00.000Z",
  ...overrides
});
const suggest = (input) => suggestSkipReasons({
  priorDecision: null,
  linkedApplication: null,
  fitResult: null,
  jobText: "",
  ...input
});
const reasonsOf = (prompt) => prompt.suggestions.map(({ reason }) => reason);

const none = suggest({});
assert.deepEqual(none, { initialReasons: [], initialNote: "", suggestions: [] }, "no evidence suggests nothing");

// Strong: a linked application the user submitted.
const linkedSubmitted = suggest({ linkedApplication: record() });
assert.deepEqual(linkedSubmitted.initialReasons, ["already_applied"]);
assert.match(
  suggest({ linkedApplication: record({ company: "Example", role: "Engineer" }) }).suggestions[0].basis,
  /^Linked to your application for Engineer at Example, applied \w+ \d+/,
  "the basis names the linked application and its date"
);
assert.deepEqual(
  suggest({ linkedApplication: record({ status: "draft", appliedAt: undefined }) }).initialReasons,
  [],
  "a linked Draft is not a submission"
);
assert.deepEqual(
  suggest({ linkedApplication: record({ status: "not_applying", appliedAt: undefined, notApplyingAt: "2026-08-03T12:00:00.000Z" }) }).suggestions,
  [],
  "a linked job-only Skipped decision is not a submission"
);

// Strong: Blocked eligibility classified from the cited posting text.
const blockedClearance = suggest({
  fitResult: fit({ eligibility: { status: "BLOCKED", jobExcerpt: "Active TS/SCI clearance required." } })
});
assert.deepEqual(blockedClearance.initialReasons, ["clearance"]);
assert.equal(blockedClearance.suggestions[0].basis, 'Fit eligibility blocked: "Active TS/SCI clearance required."');
assert.deepEqual(
  suggest({ fitResult: fit({ eligibility: { status: "BLOCKED", jobExcerpt: "Must be authorized to work in the U.S. without sponsorship." } }) }).initialReasons,
  ["work_authorization"]
);
assert.deepEqual(
  suggest({ fitResult: fit({ eligibility: { status: "BLOCKED", jobExcerpt: "U.S. citizenship required; no visa sponsorship available." } }) }).initialReasons,
  ["work_authorization", "clearance"],
  "one cited condition can name both eligibility reasons"
);
assert.deepEqual(
  suggest({ fitResult: fit({ eligibility: { status: "BLOCKED", jobExcerpt: "Must hold an active nursing license." } }) }),
  { initialReasons: [], initialNote: "", suggestions: [] },
  "an unclassifiable condition suggests nothing rather than guessing"
);
assert.deepEqual(
  suggest({ fitResult: fit({ eligibility: { status: "BLOCKED", note: "Requires security clearance and sponsorship." } }) }).suggestions,
  [],
  "the model's note is never classified; only cited posting text is"
);
assert.deepEqual(
  suggest({ fitResult: fit({ eligibility: { status: "CLEAR", jobExcerpt: "Security clearance preferred." } }) }).suggestions,
  [],
  "Clear eligibility suggests nothing"
);

// Weak: Check eligibility, detected posting wording, and a Limited verdict.
const weak = suggest({
  fitResult: fit({
    verdict: "LIMITED",
    eligibility: { status: "CHECK", jobExcerpt: "Candidates must be eligible to work in the United States." }
  }),
  jobText: "This is a fully on-site role, 5 days in office. Travel up to 25% to customer sites. On-call rotation."
});
assert.deepEqual(weak.initialReasons, [], "weak evidence is never pre-checked");
assert.deepEqual(reasonsOf(weak), ["work_authorization", "location", "schedule", "fit"]);
assert.match(weak.suggestions.find(({ reason }) => reason === "location").basis, /^Posting mentions "/);
assert.equal(weak.suggestions.find(({ reason }) => reason === "fit").basis, "Fit verdict: Limited");

// A prior decision on the same posting is the only pre-check; other evidence is
// still shown as marks, and its note is restored.
const withPrior = suggest({
  priorDecision: { notApplyingReasons: ["location", "compensation"], notApplyingNote: "Synthetic earlier note" },
  linkedApplication: record({ status: "not_applying", notApplyingAt: "2026-08-03T12:00:00.000Z" }),
  fitResult: fit({ eligibility: { status: "BLOCKED", jobExcerpt: "Active Secret clearance required." } })
});
assert.deepEqual(withPrior.initialReasons, ["location", "compensation"]);
assert.equal(withPrior.initialNote, "Synthetic earlier note");
assert.deepEqual(reasonsOf(withPrior), ["clearance", "location", "compensation", "already_applied"]);
assert.equal(
  withPrior.suggestions.find(({ reason }) => reason === "location").basis,
  "Your earlier skip of this posting"
);
assert.deepEqual(
  suggest({
    priorDecision: { notApplyingReasons: undefined },
    fitResult: fit({ eligibility: { status: "BLOCKED", jobExcerpt: "Active TS/SCI clearance required." } })
  }).initialReasons,
  [],
  "a prior decision without reasons still outranks new strong evidence"
);
assert.deepEqual(
  suggest({ priorDecision: { notApplyingReasons: ["constraints"] } }).initialReasons,
  ["constraints"],
  "a retired prior reason carries forward"
);

// Classifier boundaries: no substring or product-name matches.
for (const [excerpt, expected] of [
  ["Security clearance optional but preferred.", ["clearance"]],
  ["Active Secret clearance required; options for relocation.", ["clearance"]],
  ["Experience with Visa payment rails.", []],
  ["Optimizing for U.S. persons only.", ["clearance"]],
  ["F-1 students on STEM OPT are welcome.", ["work_authorization"]],
  ["OPT/CPT candidates welcome.", ["work_authorization"]],
  ["CPC certification required; expert in CPT and ICD-10 coding.", []],
  ["Candidates may OPT-OUT of text updates.", []],
  ["Medical clearance and drug screening required.", []],
  ["Must receive site clearance before starting.", []],
  ["Must be able to obtain a clearance.", ["clearance"]],
  ["Please opt in to text updates.", []],
  ["We are not sponsoring visas for this role.", ["work_authorization"]],
  ["Sponsored events team.", []],
  ["Public Trust required.", []],
  ["Green card holders only.", []]
]) {
  assert.deepEqual(classifyEligibilityExcerpt(excerpt), expected, excerpt);
}

const longExcerpt = `Clearance ${"x".repeat(300)}`;
const longBasis = suggest({ fitResult: fit({ eligibility: { status: "BLOCKED", jobExcerpt: longExcerpt } }) }).suggestions[0].basis;
assert.ok(longBasis.length < 200 && longBasis.endsWith('…"'), "long quoted bases are shortened");

// Reason list helpers.
assert.deepEqual(normalizeNotApplyingReasons(["other", "bogus", "fit", "fit", 3]), ["fit", "other"]);
assert.deepEqual(normalizeNotApplyingReasons("fit"), []);
assert.equal(formatNotApplyingReasons(["location", "compensation", "clearance"], 2), "Clearance, Location +1");
assert.equal(formatNotApplyingReasons(["location", "compensation", "clearance"]), "Clearance, Location, Compensation");
assert.equal(formatNotApplyingReasons(["fit"], 2), "Not a fit");
assert.equal(formatNotApplyingReasons(undefined, 2), "");

// Suggestions never reach a provider.
for (const path of ["../skipReasonSuggestions.ts", "../../hooks/useSkipFlow.ts"]) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\(|["'`]\/api\/|aiJobAnalysis|aiRequest/, `${path} makes no provider or server request`);
}

console.log("Skip reason suggestions passed");
