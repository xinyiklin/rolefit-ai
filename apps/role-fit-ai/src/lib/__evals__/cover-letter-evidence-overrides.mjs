import assert from "node:assert/strict";

import {
  applyCoverLetterEvidenceOverride,
  evidenceOverridesForPreparation,
} from "../coverLetterEvidence.ts";

const evidenceId = "resume:python";
const slotId = "slot:1:1:example";
const preparation = {
  status: "ready",
  sourceMode: "authored_letter",
  missingFields: [],
  clarifications: [],
  plan: {
    openingAngle: "Lead with verified delivery work.",
    decisions: [
      {
        evidenceId,
        decision: "use",
        relevance: "direct",
        reason: "Supports the selected candidate-connected slot.",
      },
    ],
    slotDecisions: [
      {
        slotId,
        decision: "use_candidate_evidence",
        evidenceIds: [evidenceId],
        reason: "Use the selected delivery evidence.",
      },
    ],
    voice: {
      formality: "conversational-professional",
      confidence: "confident",
      sentenceStyle: "direct",
    },
  },
};

const updated = applyCoverLetterEvidenceOverride({
  preparation,
  evidenceId,
  nextDecision: "skip",
  slots: [
    {
      id: slotId,
      raw: "[relevant project]",
      normalizedPrompt: "relevant project",
      paragraphIndex: 1,
      occurrence: 1,
      resolution: { kind: "generate", source: "candidate_evidence" },
    },
  ],
});

assert.equal(updated.plan.decisions[0].decision, "skip");
assert.equal(
  updated.status,
  "needs_input",
  "a slot-bound override cannot remain draft-ready",
);
assert.deepEqual(updated.plan.slotDecisions[0].evidenceIds, []);
assert.equal(updated.plan.slotDecisions[0].decision, "needs_input");
assert.deepEqual(updated.clarifications, [
  {
    evidenceId: slotId,
    label: "relevant project",
    required: true,
    reason:
      "Provide a replacement verified fact or identify another evidence item for this field.",
  },
]);
assert.deepEqual(
  evidenceOverridesForPreparation(updated),
  [{ evidenceId, decision: "skip" }],
  "candidate evidence choices remain explicit across a preparation refresh",
);

console.log("Cover-letter evidence override contracts passed");
