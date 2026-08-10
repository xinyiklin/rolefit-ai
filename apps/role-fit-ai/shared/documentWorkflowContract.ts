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
//   -> Reviewing proposal

export const DOCUMENT_WORKFLOW_STATES = [
  "blocked",
  "ready-to-polish",
  "polishing",
  "proposal",
  "reviewing",
  "stale"
] as const;

export type DocumentWorkflowState = (typeof DOCUMENT_WORKFLOW_STATES)[number];

// Why a proposal stopped describing what is on screen. Keep the reason with the
// state so callers can give the correct recovery action instead of a vague
// "stale" message.
export type DocumentWorkflowStaleReason =
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
  stale: "Out of date"
};

export const DOCUMENT_WORKFLOW_STALE_LABELS: Record<DocumentWorkflowStaleReason, string> = {
  "proposal-superseded": "Out of date"
};

export function documentWorkflowLabel(status: DocumentWorkflowStatus): string {
  if (status.state === "stale" && status.staleReason) {
    return DOCUMENT_WORKFLOW_STALE_LABELS[status.staleReason];
  }
  return DOCUMENT_WORKFLOW_LABELS[status.state];
}

export type DocumentWorkflowInput = Readonly<{
  // Every precondition for polishing is satisfied (document, job, provider,
  // and any document-specific requirement).
  ready: boolean;
  polishing: boolean;
  // A proposal awaiting decisions. `outstanding` counts items that still need
  // one; a cover letter's atomic proposal is 1 of 1 until it is accepted or
  // discarded, which is exactly how its single decision maps onto the shared
  // "Reviewing proposal" step without pretending it has granular edits.
  proposal: { outstanding: number; total: number } | null;
  // The proposal no longer matches the document or job it was generated for.
  proposalSuperseded: boolean;
}>;

// Live work first, then an outstanding proposal, then readiness.
export function resolveDocumentWorkflowStatus(
  input: DocumentWorkflowInput
): DocumentWorkflowStatus {
  if (input.polishing) return { state: "polishing" };

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

  return { state: input.ready ? "ready-to-polish" : "blocked" };
}
