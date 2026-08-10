import assert from "node:assert/strict";

import {
  buildCoverLetterEvidence,
  evidenceEntryName,
  splitHonestContextEvidence
} from "../coverLetterEvidence.ts";

const resumeData = {
  header: { visible: true, name: "Candidate", contact: [] },
  sections: [
    {
      id: "volatile-section-id",
      heading: "Experience",
      type: "standard",
      items: [
        {
          id: "volatile-entry-id",
          titleLeft: "Engineer",
          titleRight: "2024",
          subtitleLeft: "Acme",
          subtitleRight: "Remote",
          bullets: [
            { id: "volatile-bullet-id", text: "Built a reliable scheduling workflow." },
            { id: "another-id", text: "Improved the editor's keyboard support." }
          ]
        }
      ]
    },
    {
      id: "skills-id",
      heading: "Skills",
      type: "skills",
      items: [
        {
          id: "skill-entry",
          titleLeft: "Languages",
          titleRight: "",
          subtitleLeft: "TypeScript, Python",
          subtitleRight: "",
          bullets: []
        }
      ]
    }
  ]
};

const honestContext =
  "Candidate facts:\n- Work authorization: authorized.\n\nC++ was my primary college language.";

assert.deepEqual(
  splitHonestContextEvidence(
    "Candidate facts:\n- Work authorization: authorized.\n\nC++ was my primary college language.\nMicrosoft Office."
  ),
  [
    "Work authorization: authorized.",
    "C++ was my primary college language.",
    "Microsoft Office."
  ],
  "legacy honest context splits conservatively by authored lines"
);

assert.deepEqual(
  splitHonestContextEvidence(
    "Kubernetes: [describe your exact experience: what you did, where, and when]\n" +
      "Kubernetes: Operated a small production cluster for Acme."
  ),
  ["Kubernetes: Operated a small production cluster for Acme."],
  "unfinished Guidance prompts never become candidate evidence"
);

const evidence = buildCoverLetterEvidence({ resumeData, honestContext });
assert.equal(
  evidence.length,
  5,
  "resume bullets, skill text, and honest facts are atomic; nothing is invented"
);
assert.equal(
  new Set(evidence.map((item) => item.id)).size,
  evidence.length,
  "evidence ids are unique"
);
assert(
  evidence.every((item) => !/volatile/.test(item.id)),
  "ids never depend on disposable ResumeData session ids"
);
assert(
  evidence.some(
    (item) =>
      item.source === "resume" &&
      item.text === "Built a reliable scheduling workflow." &&
      item.section === "Experience"
  ),
  "resume evidence preserves exact source text and context"
);

// The whole corpus is offered every time. Choosing from it is the model's job,
// so nothing here filters, ranks, or pre-selects.
assert(
  evidence.some((item) => item.source === "honest_context"),
  "honest context is offered as optional evidence, never withheld"
);

const reloaded = buildCoverLetterEvidence({
  resumeData: JSON.parse(JSON.stringify(resumeData)),
  honestContext
});
assert.deepEqual(
  reloaded.map((item) => item.id),
  evidence.map((item) => item.id),
  "the same source content produces stable ids across document loads"
);

// Answers to private template slots enter the corpus like any other evidence.
const withPrivateAnswer = buildCoverLetterEvidence({
  resumeData,
  honestContext,
  slotAnswers: { "slot:3:1:abc": "Morgan Rivera referred me." },
  slotLabels: { "slot:3:1:abc": "Referral name" }
});
assert.equal(withPrivateAnswer.length, evidence.length + 1);
const answer = withPrivateAnswer.at(-1);
assert.equal(answer.source, "user_answer");
assert.equal(answer.entry, "Referral name");
assert.equal(
  buildCoverLetterEvidence({
    resumeData,
    honestContext,
    slotAnswers: { "slot:3:1:abc": "   " }
  }).length,
  evidence.length,
  "a blank answer contributes no evidence"
);

// Attribution context vs. the name provenance shows. A resume field carries the
// engine's inline-mark grammar; printing it raw is what put `<b>CareFlow</b>`
// in the rail, and it is noise in the prompt too.
const markedResume = {
  header: { visible: true, name: "Candidate", contact: [] },
  sections: [{
    id: "s", heading: "<b>Projects</b>", type: "standard",
    items: [{
      id: "e",
      titleLeft: "<b>CareFlow</b>",
      titleRight: "careflow.example.com",
      subtitleLeft: "<i>React 19, TypeScript</i>",
      subtitleRight: "",
      bullets: [{ id: "b", text: "Shipped a scheduling flow." }]
    }]
  }]
};
const [marked] = buildCoverLetterEvidence({ resumeData: markedResume, honestContext: "" });
assert.ok(marked, "a marked-up entry still produces evidence");
assert.doesNotMatch(marked.entry, /<\/?[bi]>/, "no inline-mark syntax reaches the prompt's entry context");
assert.doesNotMatch(marked.section, /<\/?[bi]>/, "or its section context");
assert.equal(
  marked.entry,
  "CareFlow · careflow.example.com · React 19, TypeScript",
  "the entry keeps the link and stack that live nowhere else in the corpus"
);
assert.equal(
  evidenceEntryName(marked.entry),
  "CareFlow",
  "while provenance shows only the entry's name"
);

// The field-level branch (an entry with no bullets) must lead with the same
// name, or provenance would report "Title detail" as the source.
const fieldOnly = buildCoverLetterEvidence({
  resumeData: {
    header: { visible: true, name: "Candidate", contact: [] },
    sections: [{
      id: "s", heading: "Experience", type: "standard",
      items: [{
        id: "e", titleLeft: "<b>Clinic IT Assistant</b>", titleRight: "Mar 2023 - Present",
        subtitleLeft: "<i>Colden Heart Center</i>", subtitleRight: "", bullets: []
      }]
    }]
  },
  honestContext: ""
});
assert.ok(fieldOnly.length > 1, "a bulletless entry contributes its fields");
for (const item of fieldOnly) {
  assert.equal(
    evidenceEntryName(item.entry),
    "Clinic IT Assistant",
    "every field of one entry reports that entry as its source"
  );
}
assert.equal(evidenceEntryName(undefined), "", "a missing entry label names nothing");

console.log("cover-letter evidence probes: PASS");
