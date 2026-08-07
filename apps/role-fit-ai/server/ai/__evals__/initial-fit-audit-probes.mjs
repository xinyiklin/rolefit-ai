import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  resolveInitialFitAuditOutcome
} from "../recruiterAudit.ts";
import { buildStrictReviewPrompts } from "../prompts.ts";

const jobText = "Python and PostgreSQL are required for production backend services.";
const resumeText = "EXPERIENCE\nBuilt production Python services.\nSKILLS\nPython, PostgreSQL";
const strictReview = {
  verdict: "REASONABLE FIT",
  verdictReason: "Core backend requirements are covered, but scale evidence is limited.",
  coverage: [
    { category: "Required tech", keyword: "Python", status: "covered", where: "Experience" }
  ],
  gaps: [],
  rewrites: [],
  riskFlags: [],
  recommendation: {
    applyAsIs: false,
    reason: "Surface scale evidence before applying.",
    topEdits: [],
    coverLetterAngle: ""
  }
};

const valid = resolveInitialFitAuditOutcome({
  strictReview,
  aiScore: { base: 76, tailored: 76, liftReason: "No changes were proposed." }
}, jobText, resumeText);
assert.equal(valid?.score, 76, "Initial Fit returns one score for the unchanged resume");
assert.equal(valid?.review.verdict, "REASONABLE FIT", "Initial Fit retains the sanitized Recruiter Audit verdict");
assert.equal(resolveInitialFitAuditOutcome({
  strictReview,
  aiScore: { base: 75, tailored: 76, liftReason: "No changes were proposed." }
}, jobText, resumeText), null, "unequal no-change scores fail closed");
assert.equal(resolveInitialFitAuditOutcome({
  strictReview,
  aiScore: { base: 85, tailored: 85, liftReason: "No changes were proposed." }
}, jobText, resumeText), null, "score/verdict band contradictions fail closed");
assert.equal(resolveInitialFitAuditOutcome({
  strictReview: { ...strictReview, coverage: [] },
  aiScore: { base: 76, tailored: 76, liftReason: "No changes were proposed." }
}, jobText, resumeText), null, "a verdict without inspectable coverage fails closed");

const prompts = buildStrictReviewPrompts({
  jobText,
  resumeText,
  suggestedChanges: [],
  honestContext: "",
  customInstructions: ""
});
assert.match(prompts.userPrompt, /With no proposed changes, the two scores MUST be equal/, "the shared prompt pins unchanged-score equality");

const routeSource = readFileSync(new URL("../fitAudit.ts", import.meta.url), "utf8");
assert.match(routeSource, /score: outcome\.score/, "the Initial Fit route returns the one-score contract");
assert.doesNotMatch(routeSource, /base:\s*outcome|tailored:\s*outcome|aiScore:/, "the Initial Fit route exposes no base/tailored pair");
assert.match(routeSource, /resolveReviewOnlyProviderRequest\(body\)/, "Initial Fit reuses the Recruiter Audit provider settings");

console.log("initial fit audit server probes passed");
