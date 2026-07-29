// Offline half of the cover-letter quality corpus: proves the fixtures cover the
// job families the workflow has to serve, that every one of them reaches Tailor
// in a single click, and that the grader can both pass a good letter and catch a
// bad one. The live counterpart drives a real provider over the same fixtures.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { gradeCoverLetterResult } from "../coverLetterQuality.ts";
import { assembleCoverLetterText } from "../coverLetterContracts.ts";
import { buildCoverLetterPreflight } from "../../../src/lib/coverLetterPreflight.ts";

const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/cover-letter-quality.json", import.meta.url), "utf8")
);

assert.equal(fixtures.length, 13, "the quality corpus contains thirteen synthetic scenarios");
assert.equal(
  new Set(fixtures.map((fixture) => fixture.id)).size,
  fixtures.length,
  "fixture ids are unique"
);

// The job families the user's base variant actually has to serve.
for (const [label, pattern] of [
  ["general full-stack", /Full Stack Engineer/],
  ["frontend", /Frontend Engineer/],
  ["backend/platform", /Platform Engineer|Backend Engineer/],
  ["healthcare", /Healthcare Software Engineer/],
  ["applied AI", /Applied AI Engineer/]
]) {
  assert(
    fixtures.some((fixture) => pattern.test(fixture.role)),
    `the corpus covers ${label} postings`
  );
}
assert(
  fixtures.filter((fixture) => fixture.baseVariant).length >= 2,
  "the bundled base variant is a permanent fixture across more than one posting"
);
assert(
  fixtures.some((fixture) => /must still lead with/i.test(fixture.scenario)),
  "one fixture forces a lead other than the most prominent project"
);
assert(
  fixtures.some((fixture) =>
    fixture.evidence.some(
      (item) => item.source === "honest_context" && /AI assistance/i.test(item.text)
    )
  ),
  "one fixture makes an AI-workflow honest-context item relevant"
);
assert(
  fixtures.some((fixture) => /irrelevant/i.test(fixture.scenario)),
  "one fixture requires irrelevant honest context to be omitted"
);
assert(
  fixtures.some((fixture) => /Adjacent experience/i.test(fixture.scenario)),
  "one fixture requires an honest adjacent-experience framing"
);
assert(
  fixtures.some((fixture) => /Distinctive authored phrasing/i.test(fixture.scenario)),
  "one fixture protects a distinctive authored voice"
);
assert(
  fixtures.some((fixture) => /Generic source language/i.test(fixture.scenario)),
  "one fixture requires generic source language to be improved"
);
assert(fixtures.some((fixture) => fixture.sourceText === ""), "one fixture starts blank");

const sentence =
  "I approach the work with clear judgment, careful follow-through, and respect for the people who depend on the result.";

function goodResult(fixture, resolved, used) {
  const bodyParagraphs = [
    {
      text: `I am applying for the ${fixture.role} role at ${fixture.company}. ${sentence} ${sentence} ${sentence}`,
      evidenceIds: [used[0].id],
      slotIds: []
    },
    {
      text: `${sentence} ${sentence} ${sentence} ${sentence}`,
      evidenceIds: [used[0].id],
      slotIds: []
    },
    {
      text: `${sentence} ${sentence} I would welcome a conversation about the ${fixture.role} role at ${fixture.company}.`,
      evidenceIds: [used.at(-1).id],
      slotIds: []
    }
  ];
  return {
    status: "ready",
    coverLetterText: assembleCoverLetterText(bodyParagraphs, resolved),
    bodyParagraphs,
    evidenceUsed: used,
    warnings: []
  };
}

for (const fixture of fixtures) {
  assert.equal(typeof fixture.jobText, "string");
  assert(fixture.jobText.length >= 40, `${fixture.id} has a usable job description`);
  assert(fixture.evidence.length >= 1, `${fixture.id} supplies atomic evidence`);
  assert.equal(
    new Set(fixture.evidence.map((item) => item.id)).size,
    fixture.evidence.length,
    `${fixture.id} has unique evidence ids`
  );

  const preflight = buildCoverLetterPreflight({
    text: fixture.sourceText,
    candidateName: "Jordan Lee",
    role: fixture.role,
    company: fixture.company,
    date: "July 28, 2026"
  });
  // The whole point of the corpus: none of these stops to ask a question.
  assert.equal(preflight.canTailor, true, `${fixture.id} tailors in one click`);
  assert.deepEqual(preflight.blockers, [], `${fixture.id} asks the candidate nothing`);
  if (fixture.expectedGreeting) {
    assert.equal(
      preflight.resolved.greeting,
      fixture.expectedGreeting,
      `${fixture.id} resolves its greeting deterministically`
    );
  }

  const used = fixture.evidence.slice(0, Math.min(2, fixture.evidence.length));
  const report = gradeCoverLetterResult({
    result: goodResult(fixture, preflight.resolved, used),
    allEvidence: fixture.evidence,
    sourceText: preflight.template.authoredProse,
    resolved: preflight.resolved,
    onePage: true
  });
  assert.equal(report.passed, true, `${fixture.id} can satisfy every quality dimension`);
  assert.equal(report.score, 100);

  assert.equal(
    gradeCoverLetterResult({
      result: goodResult(fixture, preflight.resolved, used),
      allEvidence: fixture.evidence,
      sourceText: preflight.template.authoredProse,
      resolved: preflight.resolved,
      onePage: false
    }).checks.concise.passed,
    false,
    "page overflow is a quality failure, even though it never withholds the letter"
  );
}

// The grader has to be able to fail: a good-looking letter with brochure copy,
// an invented evidence id, or a pasted resume bullet is not a pass.
const first = fixtures[0];
const firstPreflight = buildCoverLetterPreflight({
  text: first.sourceText,
  candidateName: "Jordan Lee",
  role: first.role,
  company: first.company,
  date: "July 28, 2026"
});
const used = first.evidence.slice(0, 2);

const generic = goodResult(first, firstPreflight.resolved, used);
generic.bodyParagraphs[2].text = `I am excited to apply because I am a perfect fit. ${generic.bodyParagraphs[2].text}`;
generic.coverLetterText = assembleCoverLetterText(
  generic.bodyParagraphs,
  firstPreflight.resolved
);
assert.equal(
  gradeCoverLetterResult({
    result: generic,
    allEvidence: first.evidence,
    sourceText: firstPreflight.template.authoredProse,
    resolved: firstPreflight.resolved,
    onePage: true
  }).checks.naturalLanguage.passed,
  false
);

const unknownEvidence = goodResult(first, firstPreflight.resolved, used);
unknownEvidence.bodyParagraphs[0].evidenceIds = ["resume:invented"];
assert.equal(
  gradeCoverLetterResult({
    result: unknownEvidence,
    allEvidence: first.evidence,
    sourceText: firstPreflight.template.authoredProse,
    resolved: firstPreflight.resolved,
    onePage: true
  }).checks.evidenceGrounding.passed,
  false
);

const dumped = goodResult(first, firstPreflight.resolved, used);
dumped.bodyParagraphs[1].text = `${first.evidence[0].text} ${sentence} ${sentence}`;
dumped.coverLetterText = assembleCoverLetterText(
  dumped.bodyParagraphs,
  firstPreflight.resolved
);
assert.equal(
  gradeCoverLetterResult({
    result: dumped,
    allEvidence: first.evidence,
    sourceText: firstPreflight.template.authoredProse,
    resolved: firstPreflight.resolved,
    onePage: true
  }).checks.noResumeDump.passed,
  false,
  "a pasted resume bullet is a resume dump, not elaboration"
);

console.log("cover-letter synthetic quality contracts: PASS");
