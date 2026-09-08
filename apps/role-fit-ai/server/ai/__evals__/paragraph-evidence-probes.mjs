import assert from "node:assert/strict";
import { coverLetterParagraphClaims } from "../coverLetterParagraphEvidence.ts";
const resolved = { company: "Acme", role: "Engineer", candidateName: "Jordan Lee" };
const evidence = [
  { id: "a", source: "resume", entry: "Atlas project", text: "Built Python services." },
  { id: "b", source: "resume", entry: "Beacon project", text: "Maintained Kubernetes deployments." }
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
  review("At Atlas project I maintained Kubernetes deployments.", ["a", "b"]).issues.length
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
