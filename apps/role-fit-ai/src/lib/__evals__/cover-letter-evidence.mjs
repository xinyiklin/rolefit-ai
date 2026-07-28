import assert from "node:assert/strict";

import {
  buildCoverLetterEvidence,
  selectedEvidenceForPlan,
  splitHonestContextEvidence
} from "../coverLetterEvidence.ts";

const resumeData = {
  name: "Candidate",
  contact: [],
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

const evidence = buildCoverLetterEvidence({
  resumeData,
  honestContext:
    "Candidate facts:\n- Work authorization: authorized.\n\nC++ was my primary college language.",
  preparationValues: {
    why_role: "I want to build practical tools for coaches.",
    lead_experience: "Lead with the scheduling workflow."
  }
});
assert.equal(evidence.length, 7, "resume bullets, skill text, honest facts, and user answers are atomic");
assert.equal(new Set(evidence.map((item) => item.id)).size, evidence.length, "evidence ids are unique");
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

const reloaded = buildCoverLetterEvidence({
  resumeData: JSON.parse(JSON.stringify(resumeData)),
  honestContext:
    "Candidate facts:\n- Work authorization: authorized.\n\nC++ was my primary college language.",
  preparationValues: {
    why_role: "I want to build practical tools for coaches.",
    lead_experience: "Lead with the scheduling workflow."
  }
});
assert.deepEqual(
  reloaded.map((item) => item.id),
  evidence.map((item) => item.id),
  "the same source content produces stable ids across document loads"
);

const selected = selectedEvidenceForPlan(
  {
    openingAngle: "Product delivery",
    voice: {
      formality: "conversational-professional",
      confidence: "restrained",
      sentenceStyle: "direct"
    },
    decisions: evidence.map((item, index) => ({
      evidenceId: item.id,
      decision: index < 2 ? "use" : "skip",
      relevance: index < 2 ? "direct" : "weak",
      reason: index < 2 ? "Supports delivery." : "Not needed."
    }))
  },
  evidence
);
assert.deepEqual(selected, evidence.slice(0, 2), "selection returns only use decisions in source order");

console.log("cover-letter evidence probes: PASS");
