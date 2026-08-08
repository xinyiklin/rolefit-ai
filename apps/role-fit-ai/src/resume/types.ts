export type ResumeProposalField = "bullet" | "skill" | "skillLabel";

export type ResumeProposalTarget = {
  sectionId: string;
  entryId?: string;
  bulletId?: string;
  field: ResumeProposalField;
};

export type ResumeProposalSuggestion = {
  id: string;
  target: ResumeProposalTarget;
  sectionHeading: string;
  currentText: string;
  proposedText: string;
  reason: string;
};

export type PolishedResume = {
  polishedText: string;
  source?: "ai";
  missingKeywords: string[];
  // 1-3 bullets from the AI describing what changed (or why nothing needed
  // changing). Absent when no Resume Polish pass ran.
  changeSummary?: string[];
  suggestedChanges?: ResumeProposalSuggestion[];
  polishOutcome?: "PROPOSAL" | "NO_CHANGES" | "WITHHELD";
  remainingGaps?: string[];
  omittedTargetCount?: number;
  withheld?: {
    count: number;
    reasons: Array<"UNSUPPORTED" | "INVALID_TARGET" | "UNCHANGED" | "MALFORMED">;
  };
  trimmedBulletGroups: number;
};

export type ResumeAnalysis = Omit<PolishedResume, "polishedText">;

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
