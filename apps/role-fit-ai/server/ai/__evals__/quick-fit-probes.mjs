import assert from "node:assert/strict";

import {
  buildJobAnalysisPrompts,
  sanitizePrepareAnalysisResponse
} from "../jobAnalysis.ts";
import { buildQuickFitPrompts, sanitizeQuickFit } from "../quickFit.ts";
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
  true
);
assert.equal(independent.fields.title, "Intermediate Software Developer");
assert.deepEqual(independent.fields.requiredQualifications, ["JavaScript and SQL"]);
assert.equal(independent.initialFit, null);

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
