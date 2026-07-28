import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { gradeCoverLetterProposal } from "../coverLetterQuality.ts";
import { buildCoverLetterPreflight } from "../../../src/lib/coverLetterPreflight.ts";

const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/cover-letter-quality.json", import.meta.url), "utf8")
);
assert.equal(fixtures.length, 10, "the quality corpus contains ten synthetic scenarios");
assert.equal(
  new Set(fixtures.map((fixture) => fixture.id)).size,
  fixtures.length,
  "fixture ids are unique"
);
assert(fixtures.some((fixture) => fixture.sourceMode === "authored_letter"));
assert(fixtures.some((fixture) => fixture.sourceMode === "guided_draft"));
assert(fixtures.some((fixture) => fixture.recipientName));
assert(fixtures.some((fixture) => !fixture.recipientName));
assert(fixtures.some((fixture) => /irrelevant/i.test(fixture.scenario)));
assert(fixtures.some((fixture) => /Adjacent experience/i.test(fixture.scenario)));
assert(fixtures.some((fixture) => /Distinctive authored phrasing/i.test(fixture.scenario)));
assert(fixtures.some((fixture) => /Generic source language/i.test(fixture.scenario)));

function selectedForFixture(fixture) {
  if (fixture.sourceMode === "guided_draft") {
    const answer = fixture.evidence.find((item) => item.source === "user_answer");
    assert(answer, `${fixture.id} supplies a candidate answer`);
    const resume = fixture.evidence.find((item) => item.source === "resume");
    assert(resume, `${fixture.id} supplies resume evidence`);
    return [resume, answer];
  }
  return fixture.evidence.slice(0, 2);
}

function makeGoodProposal(fixture, resolved, selected) {
  const sentence =
    "I approach the work with clear judgment, careful follow-through, and respect for the people who depend on the result.";
  const bodyBlocks = [
    {
      kind: "body",
      text: `I am applying for the ${fixture.role} role at ${fixture.company}. ${fixture.preservePhrase ?? ""} ${sentence} ${sentence} ${sentence}`,
      evidenceIds:
        fixture.sourceMode === "authored_letter"
          ? [selected[0].id, "source_letter"]
          : selected.map((item) => item.id)
    },
    {
      kind: "body",
      text: `${sentence} ${sentence} ${sentence} ${sentence}`,
      evidenceIds: [selected[0].id]
    },
    {
      kind: "body",
      text: `${sentence} ${sentence} ${sentence} I would welcome a conversation about the ${fixture.role} role at ${fixture.company}.`,
      evidenceIds: [selected.at(-1).id]
    }
  ];
  const blocks = [
    { kind: "date", text: resolved.date, evidenceIds: [] },
    { kind: "greeting", text: resolved.greeting, evidenceIds: [] },
    ...bodyBlocks,
    { kind: "signoff", text: resolved.signoff, evidenceIds: [] }
  ];
  return {
    status: "ready",
    coverLetterText: blocks.map((block) => block.text).join("\n\n"),
    blocks,
    changeSummary: ["Focused the narrative on approved evidence."],
    preservedFromSource:
      fixture.sourceMode === "authored_letter"
        ? ["Preserved the source letter's direct voice."]
        : [],
    warnings: [],
    readyToSend: true,
    selectedEvidence: selected
  };
}

for (const fixture of fixtures) {
  assert.equal(typeof fixture.jobText, "string");
  assert(fixture.jobText.length >= 40, `${fixture.id} has a usable job description`);
  assert(fixture.evidence.length >= 2, `${fixture.id} has multiple atomic evidence items`);
  assert.equal(
    new Set(fixture.evidence.map((item) => item.id)).size,
    fixture.evidence.length,
    `${fixture.id} has unique evidence ids`
  );

  const values = {
    candidate_name: "Jordan Lee",
    role: fixture.role,
    company: fixture.company,
    recipient_name: fixture.recipientName,
    why_role: fixture.whyRole,
    lead_experience: fixture.leadExperience
  };
  const preflight = buildCoverLetterPreflight({
    text: fixture.sourceText,
    sourceMode: fixture.sourceMode,
    candidateName: "Jordan Lee",
    role: fixture.role,
    company: fixture.company,
    values,
    date: "July 28, 2026"
  });
  assert.equal(preflight.canPrepare, true, `${fixture.id} passes deterministic preflight`);

  const selected = selectedForFixture(fixture);
  const selectedIds = new Set(selected.map((item) => item.id));
  const plan = {
    openingAngle: `Connect verified experience to the ${fixture.role} role.`,
    voice: {
      formality: "conversational-professional",
      confidence: "confident",
      sentenceStyle: "direct"
    },
    decisions: fixture.evidence.map((item) => ({
      evidenceId: item.id,
      decision: selectedIds.has(item.id) ? "use" : "skip",
      relevance: selectedIds.has(item.id) ? "direct" : "weak",
      reason: selectedIds.has(item.id)
        ? "Directly supports the role."
        : "True, but not needed for this focused narrative."
    })),
    slotDecisions: []
  };
  const proposal = makeGoodProposal(fixture, preflight.resolved, selected);
  const report = gradeCoverLetterProposal({
    proposal,
    plan,
    allEvidence: fixture.evidence,
    sourceMode: fixture.sourceMode,
    sourceText: preflight.template.authoredProse,
    resolved: preflight.resolved,
    onePage: true
  });
  assert.equal(report.passed, true, `${fixture.id} can satisfy every quality dimension`);
  assert.equal(report.score, 100);

  const overflowReport = gradeCoverLetterProposal({
    proposal,
    plan,
    allEvidence: fixture.evidence,
    sourceMode: fixture.sourceMode,
    sourceText: preflight.template.authoredProse,
    resolved: preflight.resolved,
    onePage: false
  });
  assert.equal(
    overflowReport.checks.concise.passed,
    false,
    "page overflow is a hard quality failure"
  );
}

const first = fixtures[0];
const firstPreflight = buildCoverLetterPreflight({
  text: first.sourceText,
  sourceMode: first.sourceMode,
  candidateName: "Jordan Lee",
  role: first.role,
  company: first.company,
  values: {
    candidate_name: "Jordan Lee",
    role: first.role,
    company: first.company
  },
  date: "July 28, 2026"
});
const firstSelected = selectedForFixture(first);
const weakPlan = {
  openingAngle: "Test",
  voice: {
    formality: "formal",
    confidence: "restrained",
    sentenceStyle: "concise"
  },
  decisions: first.evidence.map((item) => ({
    evidenceId: item.id,
    decision: firstSelected.some((selected) => selected.id === item.id) ? "use" : "skip",
    relevance: "weak",
    reason: "Weak"
  })),
  slotDecisions: []
};
const genericProposal = makeGoodProposal(first, firstPreflight.resolved, firstSelected);
genericProposal.blocks[2].text = `I am excited to apply because I am a perfect fit. ${genericProposal.blocks[2].text}`;
genericProposal.coverLetterText = genericProposal.blocks.map((block) => block.text).join("\n\n");
const genericReport = gradeCoverLetterProposal({
  proposal: genericProposal,
  plan: weakPlan,
  allEvidence: first.evidence,
  sourceMode: first.sourceMode,
  sourceText: firstPreflight.template.authoredProse,
  resolved: firstPreflight.resolved,
  onePage: true
});
assert.equal(genericReport.checks.naturalLanguage.passed, false);
assert.equal(genericReport.checks.evidenceRelevance.passed, false);

console.log("cover-letter synthetic quality contracts: PASS");
