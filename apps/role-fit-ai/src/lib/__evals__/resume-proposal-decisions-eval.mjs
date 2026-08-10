import assert from "node:assert/strict";

import {
  clearProposalDecision,
  decisionsForProposal,
  recordProposalDecision,
  resumeProposalEditState,
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
  resumeProposalKey(proposal({
    suggestedChanges: [{
      ...suggestion,
      target: { ...suggestion.target, bulletId: "bullet-2" }
    }]
  })),
  key,
  "the full editor target path participates in proposal identity"
);
assert.notEqual(
  resumeProposalKey(proposal({ polishOutcome: "WITHHELD" })),
  key,
  "the proposal outcome participates in proposal identity"
);

assert.equal(
  resumeProposalEditIsPending(suggestion.currentText, suggestion, { kind: "accepted", text: suggestion.proposedText }),
  false,
  "a document edit that supersedes an accepted decision does not revive destructive proposal controls"
);
assert.equal(
  resumeProposalEditState(suggestion.currentText, suggestion, { kind: "accepted", text: suggestion.proposedText }),
  "changed",
  "restoring the original outside proposal Undo is a later document edit"
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
assert.equal(
  resumeProposalEditState(suggestion.proposedText, suggestion, {
    kind: "accepted",
    text: suggestion.proposedText
  }),
  "accepted",
  "an accepted decision is current only while the document still holds its accepted text"
);
assert.equal(
  resumeProposalEditState("Manually revised after acceptance.", suggestion, {
    kind: "accepted",
    text: suggestion.proposedText
  }),
  "changed",
  "a later manual edit supersedes an accepted decision instead of exposing destructive Undo"
);
assert.equal(
  resumeProposalEditState("Manually revised after discard.", suggestion, { kind: "discarded" }),
  "changed",
  "a later manual edit supersedes a discarded decision"
);

// Undo returns one row to the queue without disturbing its siblings or the
// proposal identity the rest of the decisions hang from.
const sibling = { ...suggestion, id: "target-2" };
let undoState = { proposalKey: key, byTargetId: {} };
undoState = recordProposalDecision(undoState, key, suggestion.id, { kind: "accepted", text: suggestion.proposedText });
undoState = recordProposalDecision(undoState, key, sibling.id, { kind: "discarded" });
undoState = clearProposalDecision(undoState, key, suggestion.id);
assert.deepEqual(
  undoState,
  { proposalKey: key, byTargetId: { [sibling.id]: { kind: "discarded" } } },
  "undo removes only its own decision"
);
assert.equal(
  resumeProposalEditIsPending(suggestion.currentText, suggestion, undoState.byTargetId[suggestion.id]),
  true,
  "and the reverted row is waiting for a decision again once its original text is back"
);
assert.equal(
  clearProposalDecision(undoState, key, "target-absent"),
  undoState,
  "undoing a row that never had a decision changes nothing"
);
assert.equal(
  clearProposalDecision(undoState, replacementKey, sibling.id),
  undoState,
  "and an undo aimed at another proposal identity cannot reach these decisions"
);

console.log("Resume proposal decision identity eval: passed");
