import assert from "node:assert/strict";
import { FIT_ASSESSMENT_RESPONSE_SCHEMA, evaluateFitAssessmentResponse, sanitizeFitAssessmentResponse } from "../fitAssessment.ts";
import { excerptSourceHeadings } from "../fitEvidence.ts";
import { sanitizeFitAssessment } from "../../../shared/fitAssessmentContract.ts";
import { fitAssessmentMeetsThreshold } from "../../../src/lib/autoPolishPolicy.ts";

function assess(jobText, resumeText, patch = {}) {
  return sanitizeFitAssessmentResponse({
    status: "ASSESSED", verdict: "STRONG",
    matches: [{ jobExcerpt: jobText, candidateSource: "RESUME", candidateExcerpt: resumeText }],
    gaps: [], ...patch
  }, { jobText, resumeText });
}
assert.doesNotMatch(FIT_ASSESSMENT_RESPONSE_SCHEMA, /coverageComplete|requirements|heading|alternatives/);
for (const [job, resume] of [
  ["Build Python services.", "Developed Python services."],
  ["Familiarity with REST APIs.", "Built REST endpoints."],
  ["Experience with ML.", "Built machine learning models."],
  ["Experience with NLP.", "Built natural language processing models."],
  ["Professional or personal Python experience.", "Personal Python experience."],
  ["Experience with Python programming.", "Built Python APIs."],
  ["At least three years of professional Python experience.", "Five years of professional Python experience."],
  ["Production Python deployments.", "Built personal Python deployments in production."],
  ["Rust or Go experience.", "Rust experience."]
]) assert.ok(assess(job, resume), "ordinary evidence does not need literal prose or numeric equality");
// Acceptance here verifies source integrity, not the model's semantic judgment.
for (const [job, resume] of [
  ["Foundational understanding of software design, APIs, databases, and cloud environments (AWS, Azure, etc.)", "Designed APIs and databases and deployed services on AWS."],
  ["AWS and Azure experience required.", "Deployed services on AWS."],
  ["Lead service delivery.", "Delivered services."],
  ["Build services.", "Documented services."],
  ["Build Python services.", "Documented Python services."],
  ["Build Python services.", "Built Go services."],
  ["Build Python services.", "Played volleyball with friends."]
]) assert.ok(assess(job, resume), "the model owns relevance, tool coverage, and responsibility judgment");
for (const [job, resume] of [
  ["Python experience.", "I have never used Python."],
  ["Python experience.", "I am currently learning Python."],
  ["Professional Python experience.", "Personal Python experience."],
  ["Professional Python experience required; personal projects do not count.", "Personal Python projects."]
]) assert.ok(assess(job, resume)?.warnings?.length, "explicit evidence conflicts remain detected and advisory");
assert.ok(sanitizeFitAssessmentResponse({
  verdict: "STRONG", matches: [{ jobExcerpt: "Python experience.", candidateSource: "RESUME", candidateExcerpt: "used Python" }], gaps: []
}, { jobText: "Python experience.", resumeText: "I have never used Python." })?.warnings?.length);

const transferableGap = { jobExcerpt: "Build Kubernetes deployments.", status: "NOT_SHOWN", relationship: "transferable", candidateSource: "RESUME", candidateExcerpt: "Built Docker deployments." };
const transferable = assess(transferableGap.jobExcerpt, transferableGap.candidateExcerpt, { verdict: "STRETCH", matches: [], gaps: [transferableGap] });
assert.equal(transferable?.verdict, "STRETCH");
assert.equal(transferable.gapDetails?.[0].relationship, "transferable");
assert.equal(sanitizeFitAssessment(transferable)?.verdict, "STRETCH", "browser and saved readers accept the same compact result");
assert.ok(assess(transferableGap.jobExcerpt, transferableGap.candidateExcerpt, { verdict: "STRONG", matches: [], gaps: [transferableGap] })?.warnings?.length);

for (const [relationship, evidence] of [
  ["contradictory", "I have used Python."],
  ["contradictory", "I have never used Kubernetes."],
  ["transferable", "I have never used Python."]
]) {
  const gap = { jobExcerpt: "Python experience.", status: "NOT_SHOWN", relationship, candidateSource: "RESUME", candidateExcerpt: evidence };
  const result = assess(gap.jobExcerpt, evidence, { verdict: "LIMITED", matches: [], gaps: [gap] });
  assert.deepEqual(result?.gaps, [gap.jobExcerpt], "bad optional evidence must preserve the gap");
  assert.equal(result.gapDetails[0].candidateExcerpt, evidence, "safe uncertain explanation is not dropped");
  assert.equal(assess(gap.jobExcerpt, evidence, { verdict: "STRETCH", matches: [], gaps: [gap] })?.verdict, "STRETCH", "uncertain evidence does not silently rewrite the model verdict");
  if (relationship === "transferable") assert.ok(result.warnings?.length, "negation still detected");
}

const insufficient = sanitizeFitAssessmentResponse({ status: "INSUFFICIENT_JOB_INFORMATION" }, { jobText: "Engineer at Synthetic Company. Apply now.", resumeText: "Built Python services." });
assert.equal(insufficient?.status, "INSUFFICIENT_JOB_INFORMATION");
assert.equal(insufficient.verdict, undefined);
assert.equal(fitAssessmentMeetsThreshold(insufficient.verdict, "LIMITED"), false);
assert.equal(sanitizeFitAssessment(insufficient)?.status, "INSUFFICIENT_JOB_INFORMATION");
assert.equal(sanitizeFitAssessment({ verdict: "LIMITED", matches: [], gaps: [] })?.status, "ASSESSED");

const condition = "No sponsorship is available unless you hold a STEM degree.";
const context = "I require sponsorship and hold a STEM degree.";
const eligible = sanitizeFitAssessmentResponse({ verdict: "LIMITED", matches: [], gaps: [], eligibility: { status: "BLOCKED", jobExcerpt: condition, candidateExcerpt: context } }, { jobText: `Build Python services.\n${condition}`, resumeText: "Rust projects.", candidateContext: context });
assert.equal(eligible?.verdict, "LIMITED");
assert.equal(eligible.eligibility?.status, "CHECK", "unproven BLOCKED eligibility is downgraded to CHECK");
assert.ok(eligible.warnings?.length);
const invented = sanitizeFitAssessmentResponse({ verdict: "LIMITED", matches: [], gaps: [], eligibility: { status: "BLOCKED", jobExcerpt: "No visa sponsorship is available.", candidateExcerpt: "I require visa sponsorship." } }, { jobText: "Build Python services.", resumeText: "Rust projects.", candidateContext: "I live in Ohio." });
assert.equal(invented.eligibility?.status, "CHECK", "invented conflict quotes cannot keep BLOCKED");
// Profile Background entries carry their experience type on Markdown headings,
// so a cited body line must inherit its heading chain for the source test.
const profile = [
  "Candidate facts:",
  "- Education: highest completed level is a bachelor's degree.",
  "",
  "## Slotwise (personal project, 2025–present)",
  "### Scheduling backend",
  "Built Python services with conflict checks.",
  "Ranked #1 in a C# code review.",
  "Delivered a paid contract integration for a local clinic in Python.",
  "",
  "## Acme Clinic — Support Engineer (professional, 2021–2023)",
  "Automated patient intake reports with Python.",
  "Built a personal Python budgeting app on weekends.",
  "",
  "## Experience by type",
  "- Personal / independent projects: 3 roles or projects."
].join("\n");
const professionalRequirement = "Three years of professional Python experience.";
function assessProfile(jobText, candidateExcerpt, patch = {}) {
  return sanitizeFitAssessmentResponse({
    status: "ASSESSED", verdict: "STRONG",
    matches: [{ jobExcerpt: jobText, candidateSource: "CANDIDATE_CONTEXT", candidateExcerpt }],
    gaps: [], ...patch
  }, { jobText, resumeText: "Built Python services.", candidateContext: profile });
}
const conflictWarnings = (result) => (result?.warnings ?? []).filter((warning) => /explicit conflict/.test(warning));
assert.deepEqual(
  excerptSourceHeadings(profile, "Built Python services with conflict checks."),
  ["Slotwise (personal project, 2025–present)"],
  "an untyped subheading defers to the nearest typed ancestor"
);
assert.deepEqual(excerptSourceHeadings(profile, "Automated patient intake reports with Python."), ["Acme Clinic — Support Engineer (professional, 2021–2023)"], "the nearest typed heading replaces earlier siblings");
assert.deepEqual(excerptSourceHeadings(profile, "Not in the profile."), [""], "an unlocated excerpt has no heading");
assert.deepEqual(excerptSourceHeadings("Ranked #1 overall.\nBuilt APIs.", "Built APIs."), [""], "a # inside prose is not a heading");
assert.equal(conflictWarnings(assessProfile(professionalRequirement, "Built Python services with conflict checks.")).length, 1, "a body line under a personal-project heading conflicts with a professional requirement");
assert.equal(conflictWarnings(assessProfile(professionalRequirement, "Ranked #1 in a C# code review.")).length, 1, "heading-like prose does not break the chain");
assert.equal(conflictWarnings(assessProfile(professionalRequirement, "Automated patient intake reports with Python.")).length, 0, "a professional heading clears the source test");
assert.equal(conflictWarnings(assessProfile(professionalRequirement, "Delivered a paid contract integration for a local clinic in Python.")).length, 0, "paid work stated in the line itself clears a personal heading");
const personalLine = "Built a personal Python budgeting app on weekends.";
assert.equal(conflictWarnings(assessProfile(professionalRequirement, personalLine)).length, 1, "personal work stated in the line itself is not cleared by a professional heading");
assert.ok(!(assessProfile(professionalRequirement, personalLine, {
  verdict: "STRETCH", matches: [],
  gaps: [{ jobExcerpt: professionalRequirement, status: "NOT_SHOWN", relationship: "contradictory", candidateSource: "CANDIDATE_CONTEXT", candidateExcerpt: personalLine }]
})?.warnings ?? []).some((warning) => /could not be confirmed/.test(warning)), "a contradiction citing a personal line under a professional heading is confirmed");
assert.equal(conflictWarnings(assessProfile(professionalRequirement, "- Personal / independent projects: 3 roles or projects.")).length, 1, "migrated experience-type lines still carry their own type");
assert.equal(conflictWarnings(assessProfile("Python experience.", "Built Python services with conflict checks.")).length, 0, "a source-neutral requirement accepts personal work");
// Reverse-chronological order puts the professional entry first; a cited
// personal heading (in any shape) must still carry its own type.
const professionalFirst = [
  "## Acme Clinic — Support Engineer (professional, 2021–2023)",
  "Automated patient intake reports with Python.",
  "",
  "## Slotwise (personal project, 2025–present)",
  "Built Python services with conflict checks.",
  "",
  "## Notes",
  "```",
  "# professional build script",
  "```",
  "Built Python services with conflict checks."
].join("\n");
function assessProfileText(candidateContext, candidateExcerpt, patch = {}) {
  return sanitizeFitAssessmentResponse({
    status: "ASSESSED", verdict: "STRONG",
    matches: [{ jobExcerpt: professionalRequirement, candidateSource: "CANDIDATE_CONTEXT", candidateExcerpt }],
    gaps: [], ...patch
  }, { jobText: professionalRequirement, resumeText: "Built Python services.", candidateContext });
}
for (const cited of [
  "Slotwise (personal project, 2025–present)",
  "## Slotwise (personal project, 2025–present)",
  "## Slotwise (personal project, 2025–present)\nBuilt Python services with conflict checks."
]) {
  assert.equal(conflictWarnings(assessProfileText(professionalFirst, cited)).length, 1, `a cited personal heading keeps its own type: ${JSON.stringify(cited.slice(0, 12))}`);
  const gap = { jobExcerpt: professionalRequirement, status: "NOT_SHOWN", relationship: "contradictory", candidateSource: "CANDIDATE_CONTEXT", candidateExcerpt: cited };
  const confirmed = assessProfileText(professionalFirst, cited, { verdict: "STRETCH", matches: [], gaps: [gap] });
  assert.ok(!(confirmed?.warnings ?? []).some((warning) => /could not be confirmed/.test(warning)), "a contradiction citing a personal heading is confirmed");
}
assert.deepEqual(
  excerptSourceHeadings(professionalFirst, "Built Python services with conflict checks."),
  ["Slotwise (personal project, 2025–present)", ""],
  "each occurrence gets its own heading, and fenced code never becomes one"
);
assert.equal(
  conflictWarnings(assessProfileText(professionalFirst, "Built Python services with conflict checks.")).length,
  0,
  "a line repeated under an untyped entry is not flagged when only one occurrence conflicts"
);
const repeatedGap = { jobExcerpt: professionalRequirement, status: "NOT_SHOWN", relationship: "contradictory", candidateSource: "CANDIDATE_CONTEXT", candidateExcerpt: "Built Python services with conflict checks." };
assert.ok(
  !(assessProfileText(professionalFirst, "Built Python services with conflict checks.", { verdict: "STRETCH", matches: [], gaps: [repeatedGap] })?.warnings ?? []).some((warning) => /could not be confirmed/.test(warning)),
  "one conflicting occurrence confirms a reported contradiction"
);
const unclosedFence = "## Acme (professional, 2021–2023)\nAutomated reports.\n```\n## Side app (personal project, 2024)\nBuilt Python services with conflict checks.";
assert.deepEqual(
  excerptSourceHeadings(unclosedFence, "Built Python services with conflict checks."),
  ["Side app (personal project, 2024)"],
  "an unclosed fence does not hide later headings"
);
// A model-chosen excerpt can repeat thousands of times; the sanitizer checks
// polarity once and each distinct heading once instead of once per occurrence.
const repetitive = Array.from({ length: 120 }, (_, entry) =>
  `## Entry ${entry} (${entry % 2 ? "professional" : "personal project"}, 2024)\nBuilt a data pipeline and a web app at a startup.`
).join("\n\n");
const oneLetter = { jobExcerpt: professionalRequirement, candidateSource: "CANDIDATE_CONTEXT", candidateExcerpt: "a" };
const started = performance.now();
sanitizeFitAssessmentResponse({
  status: "ASSESSED", verdict: "STRETCH",
  matches: [oneLetter, oneLetter, oneLetter],
  gaps: [0, 1, 2].map(() => ({ ...oneLetter, status: "NOT_SHOWN", relationship: "contradictory" }))
}, { jobText: professionalRequirement, resumeText: "Built Python services.", candidateContext: repetitive });
const elapsed = performance.now() - started;
assert.ok(elapsed < 1_000, `a thousand-fold repeated excerpt stays cheap (${Math.round(elapsed)} ms)`);
const typedAncestor ="## Personal projects\n### Slotwise (2025–present)\nBuilt Python services with conflict checks.";
assert.equal(conflictWarnings(assessProfileText(typedAncestor, "Built Python services with conflict checks.")).length, 1, "a typed group heading covers untyped entries beneath it");
const resumeWithHeading = "## Slotwise (personal project, 2025–present)\nBuilt Python services with conflict checks.";
assert.equal(conflictWarnings(sanitizeFitAssessmentResponse({
  status: "ASSESSED", verdict: "STRONG",
  matches: [{ jobExcerpt: professionalRequirement, candidateSource: "RESUME", candidateExcerpt: "Built Python services with conflict checks." }], gaps: []
}, { jobText: professionalRequirement, resumeText: resumeWithHeading, candidateContext: profile })).length, 0, "resume matches keep excerpt-only source checks");
const contradictoryGap = { jobExcerpt: professionalRequirement, status: "NOT_SHOWN", relationship: "contradictory", candidateSource: "CANDIDATE_CONTEXT", candidateExcerpt: "Built Python services with conflict checks." };
const confirmedContradiction = assessProfile(professionalRequirement, "Built Python services with conflict checks.", { verdict: "STRETCH", matches: [], gaps: [contradictoryGap] });
assert.ok(!(confirmedContradiction?.warnings ?? []).some((warning) => /could not be confirmed/.test(warning)), "a heading-typed contradiction is confirmed");
const endToEnd = evaluateFitAssessmentResponse({
  status: "ASSESSED", verdict: "STRONG",
  matches: [{ jobExcerpt: professionalRequirement, candidateSource: "CANDIDATE_CONTEXT", candidateExcerpt: "Built Python services with conflict checks." }], gaps: []
}, { jobText: professionalRequirement, resumeText: "Built Python services.", candidateContext: profile });
assert.equal(endToEnd.fitAssessmentError, undefined);
assert.equal(endToEnd.fitAssessment?.verdict, "STRONG", "the warning stays advisory and never rewrites the verdict");
assert.equal(conflictWarnings(endToEnd.fitAssessment).length, 1, "the canned response carries the source-conflict warning end to end");
console.log("Compact Fit refinement and explicit-conflict probes passed");
