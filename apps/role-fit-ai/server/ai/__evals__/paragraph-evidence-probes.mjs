import assert from "node:assert/strict";
import { coverLetterParagraphClaims } from "../coverLetterParagraphEvidence.ts";
const resolved = { company: "Acme", role: "Engineer", candidateName: "Jordan Lee" };
const evidence = [
  { id: "a", source: "resume", section: "Projects", entry: "Atlas · Jan 2026 – Present", text: "Built Python services." },
  { id: "b", source: "resume", section: "Projects", entry: "Beacon · Mar 2026 – Present", text: "Maintained Kubernetes deployments." }
];
function review(text, evidenceIds, claims, jobText = "Acme needs Kubernetes experience.") {
  return coverLetterParagraphClaims({
    paragraphs: [{ text, evidenceIds, slotIds: [] }],
    evidence,
    authoredProse: "",
    jobText,
    resolved
  });
}
assert.equal(review("I built Python services.", ["a"]).issues.length, 0);
assert.ok(review("I maintained Kubernetes deployments.", ["a"]).issues.length);
assert.ok(review("I built Terraform services.", ["a"]).issues.length);
assert.ok(review("I led the organization building Python services.", ["a"]).issues.length);
assert.ok(
  review("In Atlas I maintained Kubernetes deployments.", ["a", "b"]).issues.length
);
assert.ok(review("Acme runs Terraform across its platform.", ["a"]).issues.length);
assert.equal(
  review(
    "Acme runs Kubernetes across its platform.",
    ["a"],
    undefined,
    "Acme runs Kubernetes across its platform."
  ).issues.length,
  0
);
// Auxiliary model metadata cannot change whether otherwise safe prose is accepted.
assert.equal(review("I built Python services.", ["a"], [{ evidenceId: "b" }]).issues.length, 0);
for (const text of [
  "Using Python, I built services.",
  "I built Python services and maintained Kubernetes deployments.",
  "Acme builds tools for clinicians."
]) assert.equal(review(text, ["a", "b"], undefined, "Acme builds software tools for clinicians.").issues.length, 0);
console.log("Paragraph source, ownership, attribution, paraphrase and employer evidence probes passed");

function reviewSource(text, source, jobText = "Acme needs engineers.") {
  return coverLetterParagraphClaims({
    paragraphs: [{ text, evidenceIds: ["source"], slotIds: [] }],
    evidence: [{ id: "source", source: "resume", text: source }],
    authoredProse: "", jobText, resolved
  });
}
assert.equal(reviewSource("I built REST APIs.", "Built REST endpoints.").issues.length, 0);
assert.equal(reviewSource("I built Python services.", "Built Python services that never lost data.").issues.length, 0);
assert.equal(reviewSource("I reduced latency by 20%.", "Reduced latency by 20% and increased throughput by 10%.").issues.length, 0);
const wrongMetric = reviewSource("I increased throughput by 20%.", "Reduced latency by 20% and increased throughput by 10%.");
assert.equal(wrongMetric.issues.length, 1);
assert.equal(wrongMetric.issues[0].code, "unsupported_number");
assert.ok(reviewSource("I worked at ImaginaryCorp building Python services.", "Built Python services.").issues.length);
assert.ok(reviewSource("I worked at Acme building Python services.", "Built Python services.", "Acme needs Python engineers.").issues.length);
assert.equal(reviewSource("I worked at Acme building Python services.", "Worked at Acme building Python services.").issues.length, 0);

assert.equal(reviewSource("At Acme I built Python services.", "At Acme, I built Python services.").issues.length, 0);
assert.equal(reviewSource("At Acme, I built Python services.", "At Acme, I built Python services.").issues.length, 0);
assert.ok(reviewSource("At ImaginaryCorp I built Python services.", "At Acme, I built Python services.").issues.length);

const contradictory = reviewSource("I built Kubernetes services.", "Built Kubernetes services. I have never used Kubernetes.");
assert.ok(contradictory.warnings.some(w=>/conflict/i.test(w)), "conflicting evidence requires review");
assert.deepEqual(reviewSource("I built Python services.", "Built Python services. I have never used Terraform.").warnings, []);
assert.deepEqual(reviewSource("I built Kubernetes services.", "Built Kubernetes services.").warnings, []);

// 2026-10-30: an invented workplace or school is caught in any affiliation frame, checked
// against all of the candidate's evidence; the target employer stays the application.
function reviewEmployer(text) {
  return coverLetterParagraphClaims({
    paragraphs: [{ text, evidenceIds: ["r1"], slotIds: [] }],
    evidence: [
      { id: "r1", source: "resume", section: "Experience", entry: "Software Engineer · Beta Corp · 2020 - 2024", text: "Built payment APIs in Java for merchant onboarding." },
      { id: "e1", source: "resume", section: "Education", entry: "B.S. Computer Science · State University · 2016 - 2020", text: "Dean's list." }
    ],
    authoredProse: "", jobText: "Harbor is hiring a Payments Engineer. Harbor serves millions of merchants.",
    resolved: { company: "Harbor", role: "Payments Engineer", candidateName: "Jordan Lee" }
  });
}
const affiliationIssue = (text) => reviewEmployer(text).issues.find((issue) => /Unsupported affiliation/.test(issue.repairMessage ?? ""));
for (const text of [
  "While at Stripe, I built payment APIs in Java for merchant onboarding.",
  "I built payment APIs in Java for merchant onboarding at Stripe.",
  "At Stripe, I built payment APIs in Java for merchant onboarding.",
  "As a payments engineer at Stripe, I built payment APIs in Java.",
  "I built payment APIs in Java for Stripe.",
  "Back at Stripe, I built payment APIs in Java.",
  "With a degree in CS from Stanford, I built payment APIs in Java.",
  "As a Stanford graduate, I built payment APIs in Java.",
  "I built payment APIs on Stripe's payments team.",
  "I built payment APIs at Beta Corp and Stripe.",
  "Working at Stripe taught me to build payment APIs in Java.",
  "Previously, at Stripe, I built payment APIs in Java.",
  "As Stripe's first payments engineer, I built payment APIs in Java.",
  "I earned a B.A. in Economics from Stanford.",
  "Stripe, where I built payment APIs in Java, taught me a lot.",
  "I build payment APIs at Stripe."
]) assert.match(affiliationIssue(text)?.repairMessage ?? "", /Unsupported affiliation: (?:Stripe|Stanford)\./, text);
for (const text of [
  "I built payment APIs in Java for merchant onboarding at Beta Corp.",
  "I built payment APIs in Java at Beta Corp's payments team.",
  "I built payment APIs in Java, and I would bring that care to payments at Harbor.",
  "I built payment APIs in Java for merchant onboarding, the kind of work done at Harbor.",
  "I want to build payment APIs at Harbor.",
  "At Harbor, I would build payment APIs in Java.",
  "As a State University graduate, I built payment APIs in Java.",
  "I built payment APIs in Java for Spanish-speaking merchants.",
  "I'd love to join Harbor's payments team.",
  "I built reporting dashboards in Java for Finance and Operations.",
  "I built payment APIs in Java for Medicare and Medicaid billing.",
  "I built payment APIs in Java for Visa and Mastercard transactions.",
  "I shipped a payment API in Java at Thanksgiving.",
  "I presented our payment APIs at PyCon.",
  "I was impressed by the engineering culture at Harbor."
]) assert.equal(reviewEmployer(text).issues.length, 0, text);
// Multiplier verbs and scale words are claims in a letter; a scale the posting states describes the employer.
assert.ok(reviewEmployer("I built payment APIs in Java for merchant onboarding, which doubled merchant conversion.").issues.some((issue) => issue.code === "unsupported_outcome"));
assert.ok(reviewEmployer("I built payment APIs in Java for millions of merchants.").issues.some((issue) => issue.code === "unsupported_number"));
assert.equal(reviewEmployer("Harbor's platform reaches millions of merchants, and I built payment APIs in Java.").issues.length, 0);
console.log("Paragraph affiliation, outcome-verb and scale-word probes passed");
// Second review (2026-10-30): the target employer still counts when a sentence opens
// "At Harbor," and reports work; the base letter, another school, or someone else's
// job never grounds a workplace; an intention later in the sentence hides nothing.
assert.match(affiliationIssue("At Harbor, I built payment APIs in Java for merchant onboarding.")?.repairMessage ?? "", /Unsupported affiliation: Harbor\./);
for (const text of [
  "At Stripe I built payment APIs in Java, like the onboarding service.",
  "At Stripe I built payment APIs in Java that can scale.",
  "I worked at Washington State University building payment APIs in Java.",
  "I built payment APIs in Java at Harbor Freight."
]) assert.ok(affiliationIssue(text), text);
const withBaseLetter = coverLetterParagraphClaims({
  paragraphs: [{ text: "I worked at Stripe building payment APIs in Java.", evidenceIds: ["r1"], slotIds: [] }],
  evidence: [{ id: "r1", source: "resume", section: "Experience", entry: "Software Engineer · Beta Corp · 2020 - 2024", text: "Built payment APIs in Java for merchant onboarding." }],
  authoredProse: "I am excited to apply to Stripe for the payments role.", jobText: "Harbor is hiring a Payments Engineer.",
  resolved: { company: "Harbor", role: "Payments Engineer", candidateName: "Jordan Lee" }
});
assert.ok(withBaseLetter.issues.some((issue) => /Unsupported affiliation: Stripe\./.test(issue.repairMessage ?? "")), "the base letter does not ground a workplace");
for (const text of [
  "As a former Harbor customer, I built payment APIs in Java.",
  "My sister, an engineer at Stripe, introduced me to payment APIs, and I built them in Java.",
  "Last year I attended the Grace Hopper Celebration and built payment APIs in Java."
]) assert.equal(affiliationIssue(text), undefined, text);
console.log("Paragraph second-review affiliation probes passed");
// Third review (2026-10-30): schools never ground each other in either direction, a
// corporate suffix is part of one company, and co-founding claims a workplace.
const michigan = (text) => coverLetterParagraphClaims({
  paragraphs: [{ text, evidenceIds: ["r1"], slotIds: [] }],
  evidence: [
    { id: "r1", source: "resume", section: "Experience", entry: "Software Engineer · Beta Corp · 2020 - 2024", text: "Built payment APIs in Java for merchant onboarding." },
    { id: "e1", source: "resume", section: "Education", entry: "B.S. Computer Science · Michigan State University · 2016 - 2020", text: "Dean's list." }
  ],
  authoredProse: "", jobText: "Harbor is hiring a Payments Engineer.",
  resolved: { company: "Harbor", role: "Payments Engineer", candidateName: "Jordan Lee" }
}).issues.map((issue) => issue.repairMessage ?? "").join(" ");
assert.match(michigan("I graduated from the University of Michigan and built payment APIs in Java."), /Unsupported affiliation: University of Michigan\./);
assert.equal(michigan("I graduated from Michigan State University and built payment APIs in Java."), "");
assert.equal(michigan("I worked at Beta Corp, Inc. building payment APIs in Java."), "");
assert.match(michigan("I co-founded Plaid Labs and built payment APIs in Java."), /Unsupported affiliation: Plaid Labs\./);
console.log("Paragraph third-review affiliation probes passed");
