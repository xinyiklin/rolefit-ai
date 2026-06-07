export type ResumeScore = {
  overall: number;
  keywordFit: number;
  bulletQuality: number;
  structure: number;
  concision: number;
  seniority: number;
};

// AI-judged fit on the same 0-100 scale as the local engine, scoring the
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

// A base/tailored comparison restored from a saved pipeline snapshot. We no
// longer hold the original base resume to recompute locally, so the numbers and
// their provenance ("ai" vs. "local") are carried through verbatim — a local
// estimate must not later render as "AI-judged".
export type SavedFitComparison = {
  source: "ai" | "local";
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

export type PolishedResume = {
  polishedText: string;
  coverLetterText?: string;
  source?: "ai" | "local";
  score: ResumeScore;
  aiScore?: AiFitScore;
  savedFit?: SavedFitComparison;
  topKeywords: string[];
  matchedKeywords: string[];
  missingKeywords: string[];
  strengths: string[];
  fixes: string[];
  missingRequiredSkills?: MissingRequiredSkill[];
  trimmedBulletGroups: number;
  strictReview?: StrictReview;
  // Friendly label of the independent reviewer that ran the strict audit, set
  // only when it differs from the rewrite provider (i.e. an audit override).
  reviewedBy?: string;
};

export type ResumeAnalysis = Omit<PolishedResume, "polishedText" | "strengths" | "fixes">;

export type MatchBreakdown = {
  category: string;
  covered: string[];
  missing: string[];
};

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
