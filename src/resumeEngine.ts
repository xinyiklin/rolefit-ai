// Barrel for the deterministic local resume engine. The implementation lives in
// focused modules under `src/resume/`; this file preserves the original public
// API so existing importers keep working unchanged.

export type {
  ResumeScore,
  AiFitScore,
  EvidenceType,
  MissingRequiredSkill,
  SavedFitComparison,
  StrictReviewVerdict,
  StrictReviewStatus,
  StrictReviewSeverity,
  StrictReviewCoverage,
  StrictReviewGap,
  StrictReviewRewrite,
  StrictReviewRiskFlag,
  StrictReviewRecommendation,
  StrictReview,
  TailorChangeField,
  TailorChangeRisk,
  TailorChangeTarget,
  TailorSuggestion,
  PolishedResume,
  ResumeAnalysis,
  MatchBreakdown,
  DiffSegment,
  ResumeDiff
} from "./resume/types";

export { extractKeywords } from "./resume/keywords";
export { analyzeResumeText, analyzeMatchBreakdown } from "./resume/scoring";
export { polishResume, draftCoverLetter, normalizePolishedResume } from "./resume/rewrite";
export { buildResumeDiff } from "./resume/diff";
