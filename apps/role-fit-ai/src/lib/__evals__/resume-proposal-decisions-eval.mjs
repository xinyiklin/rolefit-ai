import assert from "node:assert/strict";

import {
  clearProposalDecision,
  decisionsForProposal,
  recordProposalDecision,
  recordProposalRestore,
  restoredForProposal,
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
  proposalBaselineText: "",
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

// Held-back edits from the opt-in review are part of the payload identity from
// arrival; restoring one is decision state under the same key.
const heldSuggestion = { ...suggestion, id: "target-2", target: { ...suggestion.target, bulletId: "bullet-2" } };
const reviewedProposal = (overrides = {}) => proposal({ review: "REVIEWED", heldBack: [{ suggestion: heldSuggestion, reason: "LOW_IMPACT" }], ...overrides });
const reviewedKey = resumeProposalKey(reviewedProposal());
assert.notEqual(reviewedKey, key, "held-back edits participate in proposal identity");
assert.equal(resumeProposalKey(proposal({ heldBack: [] })), key, "a result without a review keeps today's identity");
assert.notEqual(resumeProposalKey(reviewedProposal({ heldBack: [{ suggestion: heldSuggestion, reason: "INCORRECT" }] })), reviewedKey, "the hold-back reason is part of identity");
assert.notEqual(resumeProposalKey(reviewedProposal({ review: "UNAVAILABLE", heldBack: [] })), resumeProposalKey(reviewedProposal({ heldBack: [] })), "the review outcome is part of identity");

let restoreState = recordProposalDecision({ proposalKey: reviewedKey, byTargetId: {} }, reviewedKey, suggestion.id, { kind: "accepted", text: suggestion.proposedText });
restoreState = recordProposalRestore(restoreState, reviewedKey, heldSuggestion.id);
assert.deepEqual(decisionsForProposal(restoreState, reviewedKey), { [suggestion.id]: { kind: "accepted", text: suggestion.proposedText } }, "a Restore keeps earlier decisions");
assert.deepEqual(restoredForProposal(restoreState, reviewedKey), { [heldSuggestion.id]: true });
assert.deepEqual(restoredForProposal(restoreState, key), {}, "another proposal identity sees nothing restored");
restoreState = recordProposalDecision(restoreState, reviewedKey, heldSuggestion.id, { kind: "discarded" });
assert.deepEqual(restoredForProposal(restoreState, reviewedKey), { [heldSuggestion.id]: true }, "a later decision keeps the restored set");
restoreState = clearProposalDecision(restoreState, reviewedKey, suggestion.id);
assert.deepEqual(restoredForProposal(restoreState, reviewedKey), { [heldSuggestion.id]: true }, "an Undo keeps the restored set");
const freshRestore = recordProposalRestore(restoreState, key, heldSuggestion.id);
assert.deepEqual([freshRestore.proposalKey, freshRestore.byTargetId], [key, {}], "a Restore under a new identity starts clean");
assert.equal(recordProposalDecision(restoreState, key, suggestion.id, { kind: "discarded" }).restored, undefined, "and so does a decision");

console.log("Resume proposal decision identity eval: passed");
