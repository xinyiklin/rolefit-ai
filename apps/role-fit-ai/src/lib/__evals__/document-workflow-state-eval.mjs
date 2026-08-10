import assert from "node:assert/strict";

import {
  DOCUMENT_WORKFLOW_LABELS,
  DOCUMENT_WORKFLOW_STATES,
  documentWorkflowLabel,
  resolveDocumentWorkflowStatus
} from "../../../shared/documentWorkflowContract.ts";

const base = {
  ready: true,
  polishing: false,
  proposal: null,
  proposalSuperseded: false
};
const resolve = (overrides) => resolveDocumentWorkflowStatus({ ...base, ...overrides });

assert.equal(
  DOCUMENT_WORKFLOW_STATES.every((state) => typeof DOCUMENT_WORKFLOW_LABELS[state] === "string"),
  true,
  "every workflow state has a user-facing label"
);
assert.equal(resolve({ ready: false }).state, "blocked");
assert.equal(resolve({}).state, "ready-to-polish");
assert.equal(resolve({ polishing: true }).state, "polishing");
assert.equal(resolve({ proposal: { outstanding: 4, total: 4 } }).state, "proposal");
assert.equal(resolve({ proposal: { outstanding: 2, total: 4 } }).state, "reviewing");
assert.deepEqual(
  resolve({ proposal: { outstanding: 2, total: 2 }, proposalSuperseded: true }),
  { state: "stale", staleReason: "proposal-superseded" }
);
assert.equal(documentWorkflowLabel(resolve({ proposalSuperseded: true, proposal: { outstanding: 1, total: 1 } })), "Out of date");
assert.equal(resolve({ polishing: true, proposal: { outstanding: 1, total: 2 } }).state, "polishing");

console.log("Document workflow state eval passed");
