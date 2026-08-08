// One workflow vocabulary for both documents.
//
// A resume proposal is a set of individual edits the user accepts, edits, or
// discards one at a time; a cover-letter proposal is one complete replacement
// letter accepted or discarded whole. Those units are genuinely different and
// must stay different — but the user should not have to learn two workflows to
// use one product. This module owns the states, their labels, and the single
// rule that derives one from a document's live condition, so Resume and Cover
// Letter progress through the same named sequence:
//
//   Ready to Polish -> Polishing and validating -> Proposal ready
//   -> Reviewing proposal -> Checking current document
//   -> Ready / Review / Needs evidence
//
// The internal difference the sequence hides: a resume can only be checked
// AFTER its edit decisions settle, because the final resume does not exist
// until then. A cover letter's accepted proposal is already the exact validated
// document, so it needs no second provider request to reach Ready.

import type { FinalCheckStatus } from "./finalCheckContract.ts";

export const DOCUMENT_WORKFLOW_STATES = [
  "blocked",
  "ready-to-polish",
  "polishing",
  "proposal",
  "reviewing",
  "checking",
  "ready",
  "review",
  "needs-evidence",
  "stale"
] as const;

export type DocumentWorkflowState = (typeof DOCUMENT_WORKFLOW_STATES)[number];

// Why a checked document stopped describing what is on screen. The user acts on
// these differently — one is re-check, the other is re-polish — so the reason
// travels with the state instead of collapsing into one "stale".
export type DocumentWorkflowStaleReason =
  // The document itself was edited after it was checked.
  | "document-changed"
  // The prepared job, evidence, or guidance changed under a finished result.
  | "inputs-changed"
  // A proposal no longer matches the document or job it was generated against.
  | "proposal-superseded";

export type DocumentWorkflowStatus = {
  state: DocumentWorkflowState;
  staleReason?: DocumentWorkflowStaleReason;
};

export const DOCUMENT_WORKFLOW_LABELS: Record<DocumentWorkflowState, string> = {
  blocked: "Blocked",
  "ready-to-polish": "Ready to Polish",
  polishing: "Polishing and validating",
  proposal: "Proposal ready",
  reviewing: "Reviewing proposal",
  checking: "Checking current document",
  ready: "Ready",
  review: "Review",
  "needs-evidence": "Needs evidence",
  stale: "Changed since check"
};

export const DOCUMENT_WORKFLOW_STALE_LABELS: Record<DocumentWorkflowStaleReason, string> = {
  "document-changed": "Changed since check",
  "inputs-changed": "Out of date",
  "proposal-superseded": "Out of date"
};

export function documentWorkflowLabel(status: DocumentWorkflowStatus): string {
  if (status.state === "stale" && status.staleReason) {
    return DOCUMENT_WORKFLOW_STALE_LABELS[status.staleReason];
  }
  return DOCUMENT_WORKFLOW_LABELS[status.state];
}

// The three final outcomes both documents report, mapped from the one check
// contract so a resume and a letter can never disagree about what "Ready" means.
export function documentWorkflowStateForCheck(status: FinalCheckStatus): DocumentWorkflowState {
  if (status === "READY") return "ready";
  if (status === "REVIEW") return "review";
  return "needs-evidence";
}

export type DocumentWorkflowInput = Readonly<{
  // Every precondition for polishing is satisfied (document, job, provider,
  // and any document-specific requirement).
  ready: boolean;
  polishing: boolean;
  checking: boolean;
  // A proposal awaiting decisions. `outstanding` counts items that still need
  // one; a cover letter's atomic proposal is 1 of 1 until it is accepted or
  // discarded, which is exactly how its single decision maps onto the shared
  // "Reviewing proposal" step without pretending it has granular edits.
  proposal: { outstanding: number; total: number } | null;
  // The proposal no longer matches the document or job it was generated for.
  proposalSuperseded: boolean;
  check: FinalCheckStatus | null;
  // The checked document was edited since the check settled.
  checkDocumentChanged: boolean;
  // The job, evidence, or guidance changed under a settled check.
  checkInputsChanged: boolean;
}>;

// Live work first, then an outstanding proposal, then the settled check, then
// readiness. A blocker never hides a result the user still needs to act on.
export function resolveDocumentWorkflowStatus(
  input: DocumentWorkflowInput
): DocumentWorkflowStatus {
  if (input.polishing) return { state: "polishing" };
  if (input.checking) return { state: "checking" };

  if (input.proposal) {
    if (input.proposalSuperseded) {
      return { state: "stale", staleReason: "proposal-superseded" };
    }
    // Untouched means the proposal is still an offer; part-decided means the
    // user is working through it.
    return input.proposal.outstanding === input.proposal.total
      ? { state: "proposal" }
      : { state: "reviewing" };
  }

  if (input.check) {
    if (input.checkDocumentChanged) return { state: "stale", staleReason: "document-changed" };
    if (input.checkInputsChanged) return { state: "stale", staleReason: "inputs-changed" };
    return { state: documentWorkflowStateForCheck(input.check) };
  }

  return { state: input.ready ? "ready-to-polish" : "blocked" };
}
