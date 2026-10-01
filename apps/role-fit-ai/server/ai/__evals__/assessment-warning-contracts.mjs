import assert from "node:assert/strict";
import { sanitizeFitAssessmentResponse } from "../fitAssessment.ts";
import { reviewProviderFindings } from "../applicationReview.ts";
import { sanitizeFitAssessment } from "../../../shared/fitAssessmentContract.ts";
import { localApplicationReview, sanitizeApplicationReviewResult } from "../../../shared/applicationReviewContract.ts";

// Expected labels describe the synthetic source facts independently of the detectors.
const sources = { jobText: "Python experience. No sponsorship is available.", resumeText: "I have never used Python.", candidateContext: "I require sponsorship." };
const match = { jobExcerpt: "Python experience.", candidateSource: "RESUME", candidateExcerpt: "I have never used Python." };
const base = { verdict: "STRONG", matches: [match], gaps: [] };
const counters = { missedWarnings: 0, falseWarnings: 0, incorrectlyWithheld: 0, unsafeAccepted: 0 };
for (const [label, raw] of [
  ["negated candidate evidence", base],
  ["unlocated source", { ...base, matches: [{ ...match, candidateExcerpt: "Built Python services." }] }],
  ["missing citation", { ...base, matches: [{ ...match, candidateExcerpt: "" }] }],
  ["unsupported conclusion", { ...base, matches: [] }],
  ["unconfirmed eligibility", { ...base, eligibility: { status: "BLOCKED", jobExcerpt: "Remote only.", candidateExcerpt: "Lives elsewhere." } }],
]) {
  const result = sanitizeFitAssessmentResponse(raw, sources);
  if (!result) counters.incorrectlyWithheld++;
  if (!result?.warnings?.length) counters.missedWarnings++;
  assert.ok(result, label);
  assert.ok(result.warnings?.length, label);
  assert.equal(result.verdict, raw.verdict, "the original conclusion survives");
  assert.deepEqual(sanitizeFitAssessment(result), result, "client and saved receipts keep warnings");
  if (raw.eligibility) assert.deepEqual(result.eligibility, { ...raw.eligibility, status: "CHECK", note: "Confirm this eligibility condition; the supplied context does not establish a clear conflict." }, "unproven BLOCKED is downgraded");
}
const supportedSources = { jobText: "Python experience.", resumeText: "Built Python services." };
const supported = { ...base, matches: [{ ...match, candidateExcerpt: supportedSources.resumeText }] };
if (sanitizeFitAssessmentResponse(supported, supportedSources)?.warnings?.length) counters.falseWarnings++;
// Gap notes describe absence, so naming the missing tool or the posting's duration is not a candidate claim.
const gapSources = { jobText: "Python experience. 5+ years of Kubernetes.", resumeText: supportedSources.resumeText };
for (const note of ["The resume does not mention Kubernetes or 5+ years of it.", "Candidate lacks Kubernetes experience."]) {
  const gap = { jobExcerpt: "5+ years of Kubernetes.", status: "NOT_SHOWN", note };
  if (sanitizeFitAssessmentResponse({ ...supported, verdict: "REASONABLE", gaps: [gap] }, gapSources)?.warnings?.length) counters.falseWarnings++;
}
for (const raw of [
  { ...base, verdict: "UNKNOWN" },
  { ...base, matches: [{ ...match, candidateSource: "UNKNOWN" }] },
  { ...base, matches: [{ ...match, candidateExcerpt: "<script>bad()</script>" }] },
  { ...base, matches: [{ ...match, jobExcerpt: "x".repeat(501) }] },
  { ...base, matches: Array(4).fill(match) },
]) {
  if (sanitizeFitAssessmentResponse(raw, sources)) counters.unsafeAccepted++;
}
const input = {
  jobText: supportedSources.jobText, company: "Synthetic", role: "Engineer", includeResume: true, includeCoverLetter: false,
  resumeText: supportedSources.resumeText, coverLetterText: "",
  evidence: [{ id: "original", kind: "resume", label: "Loaded resume", text: supportedSources.resumeText }],
};
const local = localApplicationReview(input);
const finding = { code: "revision", document: "resume", anchor: input.resumeText, message: "Review the technology claim.", recovery: "Confirm the wording against your records.", evidenceId: "missing", sourceExcerpt: "Built Kubernetes services." };
for (const patch of [{}, { sourceExcerpt: "" }, { anchor: "Unlocated document wording." }, { evidenceId: "job_posting", sourceExcerpt: input.jobText, recovery: "I increased revenue by 99%." }]) {
  const rawFinding = { ...finding, ...patch };
  const result = reviewProviderFindings({ coverageComplete: true, overflow: false, findings: [rawFinding] }, input, local);
  const retained = result.findings[0];
  if (!retained) counters.incorrectlyWithheld++;
  if (!retained?.warnings?.length) counters.missedWarnings++;
  assert.equal(retained?.message, rawFinding.message);
  assert.equal(retained?.recovery, rawFinding.recovery);
  assert.equal(retained?.code, rawFinding.code);
  assert.ok(retained?.warnings?.length);
  assert.deepEqual(sanitizeApplicationReviewResult(result, input), result, "client retains uncertainty");
}
for (const patch of [{ document: "unknown" }, { message: "<script>bad()</script>" }, { recovery: "x".repeat(401) }]) {
  const result = reviewProviderFindings({ coverageComplete: true, overflow: false, findings: [{ ...finding, ...patch }] }, input, local);
  if (result.findings.length) counters.unsafeAccepted++;
  assert.equal(result.complete, false);
}
assert.deepEqual(counters, { missedWarnings: 0, falseWarnings: 0, incorrectlyWithheld: 0, unsafeAccepted: 0 });

// Comparison operators and generics are ordinary text, not markup.
const comparison = { jobText: "Keep p99 latency <50ms and >99.9% availability.", resumeText: "Kept p99 <50ms with >99.9% uptime using List<T> caches.", candidateContext: "" };
const comparisonFit = sanitizeFitAssessmentResponse({ verdict: "REASONABLE", summary: "Latency <50ms and >99.9% uptime are shown.", matches: [{ jobExcerpt: "Keep p99 latency <50ms and >99.9% availability.", candidateSource: "RESUME", candidateExcerpt: comparison.resumeText }], gaps: [] }, comparison);
assert.ok(comparisonFit, "a verbatim comparison excerpt is not rejected as markup");
assert.deepEqual(sanitizeFitAssessment(comparisonFit), comparisonFit, "saved comparison excerpts round-trip");
const placeholderInput = { ...input, resumeText: "Improved latency by <insert metric>." };
const placeholderLocal = localApplicationReview(placeholderInput);
assert.ok(placeholderLocal.findings.some((item) => item.code === "placeholder"));
const placeholderReview = reviewProviderFindings({ coverageComplete: true, overflow: false, findings: [] }, placeholderInput, placeholderLocal);
assert.ok(sanitizeApplicationReviewResult(placeholderReview, placeholderInput), "an <insert …> placeholder anchor keeps the review usable");
console.log("Assessment warning fixtures:", JSON.stringify(counters));
