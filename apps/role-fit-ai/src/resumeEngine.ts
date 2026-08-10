// Barrel for the deterministic local resume engine. The implementation lives in
// focused modules under `src/resume/`; this file preserves the original public
// API so existing importers keep working unchanged.

export type {
  ResumeProposalField,
  ResumeProposalTarget,
  ResumeProposalSuggestion,
  PolishedResume,
  ResumeAnalysis,
  DiffSegment,
  ResumeDiff
} from "./resume/types";

export { extractKeywords } from "./resume/keywords";
export { analyzeResumeText } from "./resume/analysis";
export { normalizePolishedResume } from "./resume/rewrite";
export { buildResumeDiff } from "./resume/diff";
