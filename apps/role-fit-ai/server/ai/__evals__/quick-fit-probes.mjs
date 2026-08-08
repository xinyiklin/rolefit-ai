import assert from "node:assert/strict";

import {
  buildJobAnalysisPrompts,
  sanitizePrepareAnalysisResponse
} from "../jobAnalysis.ts";
import { buildQuickFitPrompts, groundQuickFit, sanitizeQuickFit } from "../quickFit.ts";
import { quickFitAllowsAutoProposal } from "../../../shared/quickFitContract.ts";

const jobText = "Intermediate Software Developer. Required: JavaScript and SQL. US citizenship required.";
const resumeText = "Software Developer with JavaScript and SQL experience building internal tools.";

const withoutFit = buildJobAnalysisPrompts({ jobText }).userPrompt;
assert.doesNotMatch(withoutFit, /selected_resume|initialFit|Initial Fit/);
assert.doesNotMatch(withoutFit, /Software Developer with JavaScript/);

const withFit = buildJobAnalysisPrompts({
  jobText,
  initialFit: {
    resumeText,
    resumeLabel: "Backend resume",
    candidateContext: "US citizen"
  }
}).userPrompt;
assert.match(withFit, /"job"/);
assert.match(withFit, /"initialFit"/);
assert.match(withFit, /<selected_resume label="Backend resume">/);
assert.match(withFit, /Software Developer with JavaScript/);

const sanitized = sanitizeQuickFit({
  verdict: "reasonable",
  summary: "The resume supports the core stack, with some role-specific depth to verify.",
  matches: ["JavaScript", "SQL", "Internal tools", "ignored fourth match"],
  gaps: ["No stated Java experience", "No public-sector domain evidence"],
  eligibility: { status: "check", note: "Confirm the citizenship requirement." }
});
assert.equal(sanitized?.verdict, "REASONABLE");
assert.equal(sanitized?.matches.length, 3);
assert.equal(sanitized?.eligibility?.status, "CHECK");
assert.equal(quickFitAllowsAutoProposal(sanitized), true);
assert.equal(
  quickFitAllowsAutoProposal({ ...sanitized, eligibility: { status: "BLOCKED" } }),
  false,
  "an eligibility blocker disables automatic proposals"
);
assert.equal(
  quickFitAllowsAutoProposal({ ...sanitized, verdict: "STRETCH" }),
  false,
  "Stretch and Limited remain manual-only"
);

assert.equal(
  sanitizeQuickFit({ verdict: "MAYBE", summary: "Looks fine." }),
  null,
  "an unknown verdict makes only the fit subsection unusable"
);

const independent = sanitizePrepareAnalysisResponse(
  {
    job: {
      title: "Intermediate Software Developer",
      requiredQualifications: ["JavaScript and SQL"]
    },
    initialFit: { verdict: "MAYBE", summary: "Invalid fit, valid job." }
  },
  jobText,
  { resumeText, resumeLabel: "Backend resume" }
);
assert.equal(independent.fields.title, "Intermediate Software Developer");
assert.deepEqual(independent.fields.requiredQualifications, ["JavaScript and SQL"]);
assert.equal(independent.initialFit, null);

// --- Adversarial grounding probes ------------------------------------------
// Initial Fit keeps a NARROW accuracy layer, not the retired evidence ledger:
// only claims that mislead an applicant are rejected, and ordinary semantic
// description is left to the model. Each probe below fails without groundQuickFit.

const groundingJob = [
  "Senior Backend Engineer at Northwind.",
  "You will build Go services on Postgres and own reliability for the payments API.",
  "Requires five years of backend experience."
].join("\n");
const groundingResume =
  "Backend engineer. Built Go services and Postgres schemas at Contoso; owned the billing API.";

const invented = groundQuickFit(
  sanitizeQuickFit({
    verdict: "REASONABLE",
    summary: "Solid backend overlap with gaps to verify.",
    matches: [
      "Go services in production",
      "Deep Kubernetes platform ownership"
    ],
    gaps: [
      "No stated five years of backend experience",
      "No Terraform module authorship",
      "No published research on quantum error correction"
    ]
  }),
  { jobText: groundingJob, resumeText: groundingResume }
);
assert.deepEqual(
  invented.matches,
  ["Go services in production"],
  "a match naming a technology absent from BOTH the posting and the resume is dropped"
);
assert.deepEqual(
  invented.gaps,
  ["No stated five years of backend experience"],
  "a gap is kept only when its distinctive terms are anchored in the posting"
);
assert.equal(invented.verdict, "REASONABLE", "the verdict is a judgement, never filtered as a claim");
assert.equal(invented.summary, "Solid backend overlap with gaps to verify.", "ordinary description is left alone");

const paraphrased = groundQuickFit(
  sanitizeQuickFit({
    verdict: "STRONG",
    summary: "Direct overlap on the stated stack.",
    // "Golang" appears only in a resume written that way; the posting says "Go".
    matches: ["Golang services and Postgres schema design"],
    gaps: ["Payments domain exposure is limited"]
  }),
  { jobText: groundingJob, resumeText: "Built Golang services and Postgres schemas." }
);
assert.deepEqual(
  paraphrased.matches,
  ["Golang services and Postgres schema design"],
  "honest paraphrase across the two sources is not treated as invention"
);
assert.deepEqual(
  paraphrased.gaps,
  ["Payments domain exposure is limited"],
  "a gap anchored by one distinctive posting term survives"
);

const inventedEligibility = groundQuickFit(
  sanitizeQuickFit({
    verdict: "STRETCH",
    summary: "Backend overlap, seniority gap.",
    matches: [],
    gaps: [],
    eligibility: { status: "BLOCKED", note: "Requires an active TS/SCI security clearance." }
  }),
  { jobText: groundingJob, resumeText: groundingResume }
);
assert.equal(
  inventedEligibility.eligibility.status,
  "BLOCKED",
  "a wrongly raised eligibility flag is kept — nothing here may invent a CLEAR"
);
assert.equal(
  inventedEligibility.eligibility.note,
  undefined,
  "an eligibility note claiming an authorization class neither source mentions is dropped"
);

const realEligibility = groundQuickFit(
  sanitizeQuickFit({
    verdict: "REASONABLE",
    summary: "Backend overlap; confirm work authorization.",
    matches: [],
    gaps: [],
    eligibility: { status: "CHECK", note: "The posting requires US citizenship." }
  }),
  { jobText: `${groundingJob}\nUS citizenship required.`, resumeText: groundingResume }
);
assert.equal(
  realEligibility.eligibility.note,
  "The posting requires US citizenship.",
  "an eligibility concern the posting actually states is preserved"
);

const contextEligibility = groundQuickFit(
  sanitizeQuickFit({
    verdict: "REASONABLE",
    summary: "Backend overlap; visa timing to confirm.",
    matches: [],
    gaps: [],
    eligibility: { status: "CHECK", note: "Confirm visa sponsorship timing." }
  }),
  {
    jobText: groundingJob,
    resumeText: groundingResume,
    candidateContext: "I will need visa sponsorship after May."
  }
);
assert.equal(
  contextEligibility.eligibility.note,
  "Confirm visa sponsorship timing.",
  "a concern anchored in the candidate's own context is preserved even when the posting is silent"
);

assert.equal(groundQuickFit(null, { jobText: groundingJob, resumeText: groundingResume }), null,
  "grounding an absent screening stays absent");

const fitOnly = buildQuickFitPrompts({
  jobText,
  resumeText,
  resumeLabel: "Backend resume",
  candidateContext: "US citizen"
}).userPrompt;
assert.match(fitOnly, /Return the Initial Fit object itself/);
assert.doesNotMatch(fitOnly, /"job"/);
assert.doesNotMatch(fitOnly, /"(?:score|confidence|requirements|recommendation|evidence)"\s*:/i);

console.log("quick Initial Fit probes: passed");
