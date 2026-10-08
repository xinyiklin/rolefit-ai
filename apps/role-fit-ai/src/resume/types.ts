import type { ResumeSourceConcern } from "./proposalWarnings.ts";
import type { TerminologySnapshot } from "./terminology.ts";
import type { ResumePolishAdvice, ResumePolishReview, ResumePolishReviewReason } from "../../shared/resumePolishContract.ts";
export type ResumeProposalField = "bullet" | "skill";

export type ResumeProposalTarget = {
  sectionId: string;
  entryId?: string;
  bulletId?: string;
  field: ResumeProposalField;
};

export type ResumeProposalSuggestion = {
  id: string;
  target: ResumeProposalTarget;
  // No kind rewrites text. "add" appends a new bullet whose id the client
  // assigned (currentText ""); "remove" cuts the target bullet (proposedText "");
  // "reorder" rearranges an entry's bullets (both texts "").
  kind?: "add" | "remove" | "reorder";
  sectionHeading: string;
  currentText: string;
  proposedText: string;
  reason: string;
  // Set when the edit relies on the entry's linked Profile text.
  evidence?: "profile";
  // The Profile heading that text came from, so a surprising link is visible.
  profileSource?: string;
  // Every Profile block linked to the entry when this proposal was requested,
  // shown beside the edit so the user can read what it rests on.
  profileEvidence?: string;
  warnings?: string[];
  // remove/reorder: the entry's bullet ids when proposed, so Undo can restore
  // a removed bullet's position and a reorder's original order.
  originalOrder?: string[];
  proposedOrder?: string[];
};

export type PolishedResume = {
  // Exact resume text when the proposal was created. Apply compares the live
  // document to this baseline; this is not an auto-applied polished output.
  proposalBaselineText: string;
  source?: "ai";
  runId?: string;
  documentGeneration?: number;
  sourceConcerns?: ResumeSourceConcern[];
  terminology?: TerminologySnapshot;
  warnings?: string[];
  missingKeywords: string[];
  // 1-3 bullets from the AI describing what changed (or why nothing needed
  // changing). Absent when no Resume Polish pass ran.
  changeSummary?: string[];
  suggestedChanges?: ResumeProposalSuggestion[];
  polishOutcome?: "PROPOSAL" | "NO_CHANGES" | "WITHHELD";
  omittedTargetCount?: number;
  advice?: ResumePolishAdvice[];
  adviceStale?: boolean;
  withheld?: {
    count: number;
    reasons: Array<"UNSUPPORTED" | "INVALID_TARGET" | "UNCHANGED" | "MALFORMED">;
  };
  // Present only when the opt-in edit review ran. Held-back edits keep their
  // suggestion identity from arrival, so Restore never changes the proposal key.
  review?: ResumePolishReview["outcome"];
  heldBack?: ResumeHeldBackEdit[];
  trimmedBulletGroups: number;
};

export type ResumeHeldBackEdit = {
  suggestion: ResumeProposalSuggestion;
  reason: ResumePolishReviewReason;
  note?: string;
};

export type ResumeAnalysis = Omit<PolishedResume, "proposalBaselineText">;

// One run of the inline before/after diff: text that is unchanged, newly added
// in the polished resume, or removed from the original. Adjacent runs of the
// same type are merged so the renderer emits the fewest spans.
export type DiffSegment = {
  type: "equal" | "added" | "removed";
  text: string;
};

export type ResumeDiff = {
  segments: DiffSegment[];
  metricPrompts: string[];
};
