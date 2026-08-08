import assert from "node:assert/strict";

import {
  decisionsForProposal,
  recordProposalDecision,
  resumeProposalEditIsPending,
  resumeProposalKey
} from "../resumeProposalDecisionState.ts";

const suggestion = {
  id: "target-1",
  target: { sectionId: "experience", entryId: "entry-1", bulletId: "bullet-1", field: "bullet" },
  sectionHeading: "Experience",
  currentText: "Built internal tools.",
  proposedText: "Built JavaScript tools for internal teams.",
  reason: "Clarifies the supported technology and audience."
};

const proposal = (overrides = {}) => ({
  polishedText: "",
  missingKeywords: [],
  trimmedBulletGroups: 0,
  polishOutcome: "PROPOSAL",
  suggestedChanges: [suggestion],
  ...overrides
});

const key = resumeProposalKey(proposal());
assert.equal(
  resumeProposalKey(proposal({ suggestedChanges: [{ ...suggestion }] })),
  key,
  "the same proposal content keeps one identity across rerenders"
);

let state = { proposalKey: key, byTargetId: {} };
state = recordProposalDecision(state, key, suggestion.id, { kind: "discarded" });
assert.deepEqual(
  decisionsForProposal(state, key),
  { [suggestion.id]: { kind: "discarded" } },
  "decisions persist for the same proposal identity"
);

const replacementKey = resumeProposalKey(proposal({
  suggestedChanges: [{ ...suggestion, proposedText: "Built SQL tools for internal teams." }]
}));
assert.notEqual(replacementKey, key, "replacement text participates in proposal identity");
assert.deepEqual(decisionsForProposal(state, replacementKey), {}, "a new replacement exposes no prior decisions");

state = recordProposalDecision(state, replacementKey, suggestion.id, { kind: "accepted", text: "Built SQL tools." });
assert.deepEqual(
  state,
  {
    proposalKey: replacementKey,
    byTargetId: { [suggestion.id]: { kind: "accepted", text: "Built SQL tools." } }
  },
  "the first decision under a new identity resets the old proposal atomically"
);

assert.notEqual(
  resumeProposalKey(proposal({ suggestedChanges: [{ ...suggestion, currentText: "Built customer tools." }] })),
  key,
  "original text participates in proposal identity"
);
assert.notEqual(
  resumeProposalKey(proposal({ suggestedChanges: [{ ...suggestion, reason: "A different reason." }] })),
  key,
  "the optional reason participates in proposal identity"
);
assert.notEqual(
  resumeProposalKey(proposal({ polishOutcome: "WITHHELD" })),
  key,
  "the proposal outcome participates in proposal identity"
);

assert.equal(
  resumeProposalEditIsPending(suggestion.currentText, suggestion, { kind: "accepted", text: suggestion.proposedText }),
  true,
  "undoing an accepted edit back to the original makes it pending again"
);
assert.equal(
  resumeProposalEditIsPending(`  ${suggestion.proposedText.toUpperCase()}  `, suggestion),
  false,
  "a manual edit matching the proposal counts as resolved"
);
assert.equal(
  resumeProposalEditIsPending(suggestion.currentText, suggestion, { kind: "discarded" }),
  false,
  "discard remains an explicit resolution while the document keeps its original text"
);

console.log("Resume proposal decision identity eval: passed");
