// Accepting Resume Polish edits outside the editor (applyResumeSuggestions)
// gives exactly the document the editor's Accept all gives: applyTarget over
// the shared editor reducer, every step reading the pre-batch document,
// reorders first. Also locks the accepted cover letter's letterhead and
// paragraph format (tailoredCoverLetterData).
import assert from "node:assert/strict";

import { coverLetterParagraphs, coverLetterResumeData } from "@typeset/engine/lib/coverLetter.ts";
import { fieldMainSizePt, setFieldOuterSize } from "@typeset/engine/lib/inlineMarksText.ts";
import { reduceResumeData } from "@typeset/editor/hooks/useResumeEditor.ts";
import { tailoredCoverLetterData } from "../coverLetterTailoring.ts";
import { applyRank, applyResumeSuggestions, applyTarget } from "../resumeProposalApply.ts";

const sized = (text) => setFieldOuterSize(text, 10);
const resume = {
  header: null,
  sections: [
    {
      id: "exp", heading: "Experience", type: "standard",
      items: [
        { id: "acme", titleLeft: "Acme", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [
          { id: "b1", text: sized("Built internal JavaScript tools.") },
          { id: "b2", text: sized("Ran the team book club.") },
          { id: "b3", text: sized("Cut CI time with GitHub Actions.") }
        ] },
        { id: "beta", titleLeft: "Beta", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [
          { id: "c1", text: "Shipped a Go API." },
          { id: "c2", text: "Wrote its docs." },
          { id: "c3", text: "Paged on call." }
        ] }
      ]
    },
    {
      id: "skills", heading: "Skills", type: "skills",
      items: [{ id: "langs", titleLeft: "Languages", titleRight: "", subtitleLeft: "Go, JavaScript", subtitleRight: "", bullets: [] }]
    }
  ]
};
const target = (entryId, bulletId, field = "bullet") => ({ sectionId: entryId === "langs" ? "skills" : "exp", entryId, bulletId, field });
const suggestions = [
  { id: "rewrite", target: target("acme", "b1"), sectionHeading: "Experience", currentText: "Built internal JavaScript tools.", proposedText: "Built internal TypeScript tools used by 40 engineers.", reason: "r" },
  { id: "add", kind: "add", target: target("acme", "new-1"), sectionHeading: "Experience", currentText: "", proposedText: "Mentored two interns.", reason: "r" },
  { id: "remove", kind: "remove", target: target("acme", "b2"), sectionHeading: "Experience", currentText: "Ran the team book club.", proposedText: "", reason: "r", originalOrder: ["b1", "b2", "b3"] },
  { id: "reorder", kind: "reorder", target: target("beta"), sectionHeading: "Experience", currentText: "", proposedText: "", reason: "r", originalOrder: ["c1", "c2", "c3"], proposedOrder: ["c3", "c1", "c2"] },
  { id: "skill", target: target("langs", undefined, "skill"), sectionHeading: "Skills", currentText: "Go, JavaScript", proposedText: "Go, TypeScript, JavaScript", reason: "r" }
];
const value = (suggestion) => suggestion.kind === "reorder" ? suggestion.proposedOrder.join("\n") : suggestion.proposedText;

// The editor's Accept all: applyTarget against the rendered (pre-batch)
// document, with actions dispatched into the shared reducer.
function editorAcceptAll(start, accepted) {
  let data = start;
  const actions = {
    addBullet: (sectionId, entryId, bullet) => { data = reduceResumeData(data, { type: "addBullet", sectionId, entryId, bullet }); },
    removeBullet: (sectionId, entryId, bulletId) => { data = reduceResumeData(data, { type: "removeBullet", sectionId, entryId, bulletId }); },
    reorderBullets: (sectionId, entryId, from, to) => { data = reduceResumeData(data, { type: "reorderBullets", sectionId, entryId, from, to }); },
    updateBullet: (sectionId, entryId, bulletId, text) => { data = reduceResumeData(data, { type: "updateBullet", sectionId, entryId, bulletId, value: text }); },
    updateEntry: (sectionId, entryId, field, text) => { data = reduceResumeData(data, { type: "updateEntry", sectionId, entryId, field, value: text }); }
  };
  for (const { suggestion, value: text } of [...accepted].sort((a, b) => applyRank(a.suggestion) - applyRank(b.suggestion))) {
    applyTarget(start, actions, suggestion, text);
  }
  return data;
}

{
  const accepted = suggestions.map((suggestion) => ({ suggestion, value: value(suggestion) }));
  const applied = applyResumeSuggestions(resume, accepted);
  assert.deepEqual(applied, editorAcceptAll(resume, accepted), "the same document as the editor's Accept all");
  const acme = applied.sections[0].items[0];
  assert.deepEqual(acme.bullets.map((bullet) => bullet.id), ["b1", "b3", "new-1"]);
  assert.equal(fieldMainSizePt(acme.bullets[0].text), 10, "a rewrite keeps its field's size");
  assert.equal(fieldMainSizePt(acme.bullets[2].text), 10, "an addition takes the size its siblings share");
  assert.deepEqual(applied.sections[0].items[1].bullets.map((bullet) => bullet.id), ["c3", "c1", "c2"]);
  assert.equal(applied.sections[1].items[0].subtitleLeft, "Go, TypeScript, JavaScript");
  assert.equal(resume.sections[0].items[0].bullets.length, 3, "the input document is not mutated");
}

// A subset, and an accepted edit with the user's own text.
{
  const accepted = [
    { suggestion: suggestions[0], value: "Built internal tools." },
    { suggestion: suggestions[3], value: value(suggestions[3]) }
  ];
  const applied = applyResumeSuggestions(resume, accepted);
  assert.deepEqual(applied, editorAcceptAll(resume, accepted));
  assert.match(applied.sections[0].items[0].bullets[0].text, /Built internal tools\./);
  assert.equal(applied.sections[0].items[0].bullets.length, 3, "unaccepted edits change nothing");
}

// An accepted cover letter keeps the letterhead and the paragraphs' shared size.
{
  const header = { visible: true, name: "Synthetic Applicant", contact: ["applicant@example.test"] };
  const current = { ...coverLetterResumeData([setFieldOuterSize("Dear Team,", 11), setFieldOuterSize("Old paragraph.", 11)]), header };
  const next = tailoredCoverLetterData(current, "Dear Team,\n\nA new grounded paragraph.\n\nSincerely,\nSynthetic Applicant");
  assert.deepEqual(next.header, header);
  assert.notEqual(next.header.contact, header.contact, "the letterhead is copied, not shared");
  const paragraphs = coverLetterParagraphs(next);
  assert.equal(paragraphs.length, 3);
  assert.ok(paragraphs.every((paragraph) => fieldMainSizePt(paragraph) === 11));
  assert.equal(tailoredCoverLetterData(null, "Hello.\n\nBye.").header, coverLetterResumeData(["x"]).header, "no current letter keeps the default letterhead");
}

console.log("resume proposal apply eval passed");
