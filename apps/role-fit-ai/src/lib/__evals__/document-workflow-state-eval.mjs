// One workflow vocabulary for two genuinely different proposal units.
//
// The product promise is that Resume and Cover Letter progress through the SAME
// named sequence even though a resume proposal is a set of individual edits and
// a cover-letter proposal is one complete replacement document. This eval pins
// that both shapes resolve to the same states, in the same order, and that the
// two stale reasons stay distinguishable — the user re-checks after editing the
// document and re-polishes after the job changes, so one label cannot serve both.
//
//   node src/lib/__evals__/document-workflow-state-eval.mjs

import assert from "node:assert/strict";

import {
  DOCUMENT_WORKFLOW_LABELS,
  DOCUMENT_WORKFLOW_STATES,
  documentWorkflowLabel,
  documentWorkflowStateForCheck,
  resolveDocumentWorkflowStatus
} from "../../../shared/documentWorkflowContract.ts";
import { FINAL_CHECK_STATUSES } from "../../../shared/finalCheckContract.ts";

let checks = 0;
const check = (actual, expected, message) => {
  checks += 1;
  assert.deepEqual(actual, expected, message);
};

const base = {
  ready: true,
  polishing: false,
  checking: false,
  proposal: null,
  proposalSuperseded: false,
  check: null,
  checkDocumentChanged: false,
  checkInputsChanged: false
};
const resolve = (overrides) => resolveDocumentWorkflowStatus({ ...base, ...overrides });

// ── Every state is reachable and labelled ───────────────────────────────────
check(
  DOCUMENT_WORKFLOW_STATES.every((state) => typeof DOCUMENT_WORKFLOW_LABELS[state] === "string"),
  true,
  "every workflow state has a user-facing label"
);
for (const status of FINAL_CHECK_STATUSES) {
  check(
    DOCUMENT_WORKFLOW_STATES.includes(documentWorkflowStateForCheck(status)),
    true,
    `the ${status} check outcome maps onto a shared workflow state`
  );
}
check(documentWorkflowStateForCheck("READY"), "ready", "READY is the Ready outcome");
check(documentWorkflowStateForCheck("REVIEW"), "review", "REVIEW is the Review outcome");
check(documentWorkflowStateForCheck("NEEDS_EVIDENCE"), "needs-evidence", "NEEDS_EVIDENCE is the Needs evidence outcome");

// ── The resume sequence: granular edits ─────────────────────────────────────
check(resolve({ ready: false }).state, "blocked", "an unsatisfied precondition blocks");
check(resolve({}).state, "ready-to-polish", "a satisfied precondition is ready to polish");
check(resolve({ polishing: true }).state, "polishing", "generation and validation are one visible step");
check(
  resolve({ proposal: { outstanding: 4, total: 4 } }).state,
  "proposal",
  "an untouched proposal is an offer"
);
check(
  resolve({ proposal: { outstanding: 2, total: 4 } }).state,
  "reviewing",
  "a part-decided proposal is under review"
);
check(resolve({ checking: true }).state, "checking", "the resulting document is checked as its own step");
for (const [status, state] of [["READY", "ready"], ["REVIEW", "review"], ["NEEDS_EVIDENCE", "needs-evidence"]]) {
  check(resolve({ check: status }).state, state, `a settled ${status} check is the final outcome`);
}

// ── The cover-letter sequence: one atomic document, same states ─────────────
// Its single accept/discard decision is 1 of 1, so it passes through the same
// "Proposal ready" step without pretending to have granular edits, and an
// accepted proposal reaches Ready with no second provider request.
check(
  resolve({ proposal: { outstanding: 1, total: 1 } }).state,
  "proposal",
  "an unaccepted letter proposal uses the same Proposal ready step"
);
check(
  resolve({ check: "READY" }).state,
  "ready",
  "an accepted letter is Ready on its Polish-time validation alone"
);

// ── Live work outranks a settled result; a blocker never hides one ──────────
check(
  resolve({ polishing: true, checking: true, proposal: { outstanding: 1, total: 2 }, check: "REVIEW" }).state,
  "polishing",
  "active polishing is reported before anything it will replace"
);
check(
  resolve({ checking: true, proposal: { outstanding: 0, total: 2 }, check: "REVIEW" }).state,
  "checking",
  "an active check outranks the previous result it will replace"
);
check(
  resolve({ ready: false, proposal: { outstanding: 2, total: 2 } }).state,
  "proposal",
  "a blocker never hides a proposal the user still has to decide"
);
check(
  resolve({ ready: false, check: "NEEDS_EVIDENCE" }).state,
  "needs-evidence",
  "a blocker never hides a finished outcome the user still has to act on"
);

// ── Staleness keeps its two distinct meanings ───────────────────────────────
check(
  resolve({ check: "READY", checkDocumentChanged: true }),
  { state: "stale", staleReason: "document-changed" },
  "editing a checked document is Changed since check"
);
check(
  resolve({ check: "READY", checkInputsChanged: true }),
  { state: "stale", staleReason: "inputs-changed" },
  "changing the job, evidence, or guidance under a result is Out of date"
);
check(
  resolve({ proposal: { outstanding: 2, total: 2 }, proposalSuperseded: true }),
  { state: "stale", staleReason: "proposal-superseded" },
  "a proposal generated against different inputs is Out of date"
);
check(
  documentWorkflowLabel(resolve({ check: "READY", checkDocumentChanged: true })),
  "Changed since check",
  "an edited document invites a re-check"
);
check(
  documentWorkflowLabel(resolve({ check: "READY", checkInputsChanged: true })),
  "Out of date",
  "changed inputs invite a re-polish, so they must not read as a document edit"
);
check(
  resolve({ check: "READY", checkDocumentChanged: true, checkInputsChanged: true }).staleReason,
  "document-changed",
  "the document's own change is the more specific reason and wins"
);

// ── Every label is a plain phrase, not a mechanism name ─────────────────────
for (const state of DOCUMENT_WORKFLOW_STATES) {
  check(
    /final check|api|provider|request/i.test(DOCUMENT_WORKFLOW_LABELS[state]),
    false,
    `the ${state} label names the user's situation, not the implementation`
  );
}

console.log(`Document workflow state eval: ${checks}/${checks} checks passed`);
