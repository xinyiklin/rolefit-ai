import assert from "node:assert/strict";
import { findUngroundedNumericClaim } from "../sanitize.ts";
import { sanitizeJobAnalysis } from "../jobAnalysis.ts";
import { affirmativeEvidenceForTerm, candidateClaimIssue } from "../claimEvidence.ts";
import { extractJobPosting } from "../../../src/lib/jobExtract.ts";

const numericCases = [
  [
    "rate cannot inflate",
    "Processed 20 requests per second.",
    "Processed 20 requests per day.",
    true
  ],
  ["count object cannot change", "Supported 20 customers.", "Supported 20 developers.", true],
  [
    "count cannot become percent",
    "Improved turnaround by 20%.",
    "Processed 20 invoices and improved turnaround.",
    true
  ],
  [
    "percent cannot become points",
    "Improved conversion by 20 percentage points.",
    "Improved conversion by 20%.",
    true
  ],
  ["metric cannot move", "Reduced costs by 20%.", "Reduced latency by 20%.", true],
  [
    "duration cannot become employment",
    "Five years of professional employment.",
    "Five years of personal projects.",
    true
  ],
  ["different count", "Processed 31 invoices.", "Processed 20 invoices.", true],
  [
    "equivalent duration",
    "Three years of personal projects.",
    "3 years of personal projects.",
    false
  ],
  ["supported measurement", "Reduced latency by 20 percent.", "Reduced latency by 20%.", false],
  ["count paraphrase", "Handled 20 invoices.", "Processed 20 invoices.", false],
  ["multiplier cannot inflate", "Handled 20 million requests.", "Handled 20 requests.", true],
  ["multiplier equivalence", "Handled 20 million requests.", "Handled 20000000 requests.", false],
  ["decimal multiplier", "Handled 3.12 million requests.", "Handled 3120000 requests.", false],
  ["tool-adjacent multiplier", "Python 3.12 million requests.", "Python 3.12 scripts.", true],
  ["marked version", "Used Python <b>3.12</b>.", "Used Python 3.12.", false],
  ["version before noun", "Built Python 3.12 scripts.", "Built scripts with Python 3.12.", false],
  ["version after noun", "Built scripts with Python 3.12.", "Built Python 3.12 scripts.", false],
  ["changed version", "Built Python 3.11 scripts.", "Built Python 3.12 scripts.", true],
  ["decimal metric", "Reduced latency by 3.12 percent.", "Reduced latency by 3.12%.", false],
  ["decimal count", "Handled 3.12 million requests.", "Handled 3.12 million requests.", false],
  ["tool-adjacent rate", "Python processed 20 requests per second.", "Python processed 20 requests per day.", true],
  ["technology version", "Used Python 3.12.", "Built scripts with Python 3.12.", false],
  ["first coordinated metric", "Reduced latency by 20%.", "Reduced latency by 20% and increased throughput by 10%.", false],
  ["second coordinated metric", "Increased throughput by 10%.", "Reduced latency by 20% and increased throughput by 10%.", false],
  ["coordinated metric cannot borrow", "Increased throughput by 20%.", "Reduced latency by 20% and increased throughput by 10%.", true],
  ["adjective is not count unit", "Supported 20 users.", "Supported 20 active users.", false],
  ["hyphenated adjective is not count unit", "Built three endpoints.", "Built three high-volume endpoints.", false],
  ["modified counts keep object", "Supported 20 customers.", "Supported 20 active developers.", true],
  ["count cannot cross preposition", "Supported 20 users.", "Generated 20 reports for users.", true],
  ["count stops at its noun", "Processed 20 invoices.", "Processed 20 invoices and supported users.", false]
];
for (const [name, claim, evidence, rejected] of numericCases) {
  assert.equal(findUngroundedNumericClaim(claim, evidence) !== null, rejected, name);
}
assert.notEqual(
  sanitizeJobAnalysis(
    { workAuth: "Visa sponsorship is available." },
    "We do not offer visa sponsorship."
  ).workAuth,
  "Visa sponsorship is available."
);
assert.equal(
  sanitizeJobAnalysis(
    { workAuth: "We do not offer visa sponsorship." },
    "We do not offer visa sponsorship."
  ).workAuth,
  "We do not offer visa sponsorship."
);
for (const [term, evidence, expected] of [
  ["Kubernetes", "I would use Kubernetes if given the opportunity.", false],
  ["Kubernetes", "I am currently learning Kubernetes.", false],
  ["Kubernetes", "I have never used Kubernetes in my work.", false],
  ["Terraform", "Interested in learning Terraform.", false],
  ["Python", "I used Python, not Kubernetes.", true],
  ["Kubernetes", "I used Python, not Kubernetes.", false],
  ["Python", "I not only used Python but also maintained it.", true],
  ["PostgreSQL", "Built reporting in Postgres.", true],
  ["Java", "Built JavaScript scripts.", false],
  ["Python", "Built Python services with no downtime.", true],
  ["Python", "Built Python services that never lost data.", true],
  ["Python", "Built Python services that did not lose data.", true],
  ["Python", "I did not use Python.", false],
  ["Kubernetes", "Used Kubernetes. I have never used Kubernetes.", false]
])
  assert.equal(affirmativeEvidenceForTerm(term, evidence), expected, evidence);
assert.ok(candidateClaimIssue("I built Terraform workflows.", "Built Python scripts."));
const classified = sanitizeJobAnalysis(
  { requiredQualifications: ["Python experience is preferred."] },
  "Preferred qualifications\nPython experience is preferred."
);
assert.deepEqual(classified.requiredQualifications, ["Python experience is preferred."]);
assert.equal(classified.conditionIssues[0]?.sourceExcerpt, "Python experience is preferred.");
const alternative =
  "Python or Java experience is required unless equivalent experience is demonstrated.";
assert.deepEqual(
  sanitizeJobAnalysis({ requiredQualifications: ["Python experience is required."] }, alternative)
    .requiredQualifications,
  [alternative]
);
const fallback = extractJobPosting(
  "Software Developer\nExample Company\nResponsibilities\nBuild Python services and support our product.\nWe do not offer visa sponsorship."
);
assert.match(fallback.tracking.workAuth, /do not offer/);
console.log("Contextual numeric, affirmative evidence, condition, and fallback checks passed");

assert.ok(findUngroundedNumericClaim("Managed €20 million.", "Managed $20 million."));
assert.equal(
  affirmativeEvidenceForTerm("Python", "Built machine learning pipelines using Python."),
  true
);

for (const duty of ["You must build Python services.", "Build bonus calculation services in Python."]) {
  assert.deepEqual(sanitizeJobAnalysis({ responsibilities: [duty] }, `Responsibilities\n${duty}`).responsibilities, [duty]);
}

assert.ok(candidateClaimIssue("Built Kubernetes services.", "Built Kubernetes services. I have never used Kubernetes."));
assert.equal(candidateClaimIssue("Built Python services.", "Built Python services. I have never used Terraform."), null);
