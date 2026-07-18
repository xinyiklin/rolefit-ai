// AI-judged fit on a 0-100 scale, scoring the
// original (base) resume and the tailored rewrite against one job in a single
// call so the lift between them is directly comparable. Populated only when an
// AI polish/strict review runs.
export type AiFitScore = {
  base: number;
  tailored: number;
  liftReason: string;
};

export type EvidenceType = "exact" | "adjacent" | "none";

export type MissingRequiredSkill = {
  keyword: string;
  evidenceType: EvidenceType;
  canHonestlyAdd: boolean;
  reason: string;
};

// A base/tailored AI comparison restored from a saved pipeline snapshot. Legacy
// local estimates are deliberately ignored by the restore path.
export type SavedFitComparison = {
  source: "ai";
  base: number;
  tailored: number;
};

export type StrictReviewVerdict = "STRONG FIT" | "REASONABLE FIT" | "STRETCH" | "DON'T APPLY";
export type StrictReviewStatus = "covered" | "missing" | "adjacent";
export type StrictReviewSeverity = "BLOCKER" | "HIGH" | "MEDIUM" | "LOW";

export type StrictReviewCoverage = {
  category: string;          // "Required tech" | "Required experience" | "Required years" | "Preferred"
  keyword: string;
  status: StrictReviewStatus;
  where: string;
};

export type StrictReviewGap = {
  gap: string;
  severity: StrictReviewSeverity;
  evidenceType?: EvidenceType;
  canHonestlyAdd: boolean;
  evidence: string;
  suggestedEdit: string;
};

export type StrictReviewRewrite = {
  original: string;
  rewrite: string;
  hits: string[];
};

export type StrictReviewRiskFlag = {
  bullet: string;
  risk: string;
  suggestion: string;
};

export type StrictReviewRecommendation = {
  applyAsIs: boolean;
  reason: string;
  topEdits: string[];
  coverLetterAngle: string;
};

export type StrictReview = {
  verdict: StrictReviewVerdict;
  verdictReason: string;
  coverage: StrictReviewCoverage[];
  gaps: StrictReviewGap[];
  rewrites: StrictReviewRewrite[];
  riskFlags: StrictReviewRiskFlag[];
  recommendation: StrictReviewRecommendation;
};

export type TailorChangeField = "bullet" | "skill" | "titleLeft" | "titleRight" | "subtitleLeft" | "subtitleRight";

export type TailorChangeRisk = "low" | "medium" | "high";

export type TailorChangeTarget = {
  sectionId: string;
  entryId?: string;
  bulletId?: string;
  field: TailorChangeField;
};

export type TailorSuggestion = {
  id: string;
  target: TailorChangeTarget;
  sectionHeading: string;
  currentText: string;
  proposedText: string;
  reason: string;
  evidenceType: EvidenceType;
  evidence: string;
  hits: string[];
  risk: TailorChangeRisk;
};

// Counts of AI suggestions the server-side sanitizer withheld, grouped by reason.
// `total` is every drop; `unsupported` is the anti-fabrication subset (ungrounded
// or no-evidence edits). Surfaced so a caught fabrication doesn't look like a
// clean "nothing to suggest" pass. Counts only — never suggestion text.
export type DroppedSuggestions = {
  total: number;
  unsupported: number;
  reasons: Record<string, number>;
};

export type PolishedResume = {
  polishedText: string;
  coverLetterText?: string;
  source?: "ai";
  aiScore?: AiFitScore;
  savedFit?: SavedFitComparison;
  missingKeywords: string[];
  // 1-3 bullets from the AI describing what changed (or why nothing needed
  // changing). Absent when no Tailor pass ran.
  changeSummary?: string[];
  missingRequiredSkills?: MissingRequiredSkill[];
  suggestedChanges?: TailorSuggestion[];
  // Anti-fabrication catches the sanitizer withheld this run (counts only, no text).
  droppedSuggestions?: DroppedSuggestions | null;
  trimmedBulletGroups: number;
  strictReview?: StrictReview;
  // Friendly label of the independent reviewer that ran the strict audit, set
  // only when it differs from the rewrite provider (i.e. an audit override).
  reviewedBy?: string;
  // Server-reported outcome of the strict-review pass: "off" = not requested,
  // "failed" = requested but produced nothing usable (strictReview absent isn't
  // enough to tell those apart), "ok" = strictReview is populated. Absent =
  // legacy response or a result that has not run AI Review.
  reviewStatus?: "ok" | "failed" | "off";
};

export type ResumeAnalysis = Omit<PolishedResume, "polishedText">;

// One run of the inline before/after diff: text that is unchanged, newly added
// in the tailored resume, or removed from the original. Adjacent runs of the
// same type are merged so the renderer emits the fewest spans.
export type DiffSegment = {
  type: "equal" | "added" | "removed";
  text: string;
};

export type ResumeDiff = {
  segments: DiffSegment[];
  metricPrompts: string[];
};
