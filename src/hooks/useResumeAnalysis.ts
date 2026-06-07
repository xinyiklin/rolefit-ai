import { useMemo } from "react";
import {
  analyzeMatchBreakdown,
  analyzeResumeText,
  buildResumeDiff,
  type PolishedResume
} from "../resumeEngine";
import type { FitComparison, ResumeBlock, ResumeBlockKind } from "../sections/shared";

type UseResumeAnalysisArgs = {
  resumeText: string;
  combinedJobText: string;
  debouncedResumeText: string;
  debouncedCombinedJobText: string;
  result: PolishedResume | null;
  resumeBlocks: ResumeBlock[];
};

// Pure, read-only derivation of every score/diff/match value the UI shows.
// Takes the raw + debounced inputs and the current polish result and returns
// the memoized derivations — it owns no state and triggers no effects, so it
// has no coupling back to App's setters (unlike the resume-source/polish
// handlers, which stay in App).
export function useResumeAnalysis({
  resumeText,
  combinedJobText,
  debouncedResumeText,
  debouncedCombinedJobText,
  result,
  resumeBlocks
}: UseResumeAnalysisArgs) {
  const currentAnalysis = useMemo(() => {
    return debouncedResumeText.trim() && debouncedCombinedJobText.trim()
      ? analyzeResumeText(debouncedResumeText, debouncedCombinedJobText)
      : null;
  }, [debouncedCombinedJobText, debouncedResumeText]);

  const resumeBulletCount = useMemo(() => {
    return resumeText.split("\n").filter((line) => /^\s*[-*•]\s+/.test(line)).length;
  }, [resumeText]);

  const matchBreakdown = useMemo(() => {
    const sourceText = result?.polishedText ?? debouncedResumeText;
    const jobText = result ? combinedJobText : debouncedCombinedJobText;
    return jobText.trim() ? analyzeMatchBreakdown(sourceText, jobText) : [];
  }, [combinedJobText, debouncedCombinedJobText, debouncedResumeText, result]);

  const resumeDiff = useMemo(
    () => (result ? buildResumeDiff(resumeText, result.polishedText) : null),
    [result, resumeText]
  );

  // Base (original resume) vs. tailored (polished) fit. Prefer the AI's
  // same-call comparison when present; otherwise score the original resume with
  // the local engine so the before/after still works without AI. `resumeText`
  // stays the original after a polish (the tailored copy lives in result), so it
  // is the base to score against.
  const fitComparison = useMemo<FitComparison | null>(() => {
    if (!result) return null;
    if (result.aiScore) {
      return { source: "ai", base: result.aiScore.base, tailored: result.aiScore.tailored, reason: result.aiScore.liftReason };
    }
    // Restored from a pipeline snapshot — carry the saved numbers and their
    // original provenance instead of recomputing (we no longer have the base).
    if (result.savedFit) {
      return { source: result.savedFit.source, base: result.savedFit.base, tailored: result.savedFit.tailored, reason: "" };
    }
    if (!combinedJobText.trim()) return null;
    const baseScore = analyzeResumeText(resumeText, combinedJobText).score.overall;
    return { source: "local", base: baseScore, tailored: result.score.overall, reason: "" };
  }, [result, resumeText, combinedJobText]);

  const blockStats = useMemo(() => {
    return resumeBlocks.reduce(
      (stats, block) => {
        stats[block.kind] += 1;
        return stats;
      },
      { contact: 0, section: 0, bullet: 0, text: 0 } as Record<ResumeBlockKind, number>
    );
  }, [resumeBlocks]);

  const scoreSource = result ?? currentAnalysis;
  // Headline FIT: the tailored score from the comparison (AI when present, else
  // local/restored), falling back to the live-draft local overall. Same 0-100
  // scale either way. Derived from fitComparison so headline, hero, and tab
  // badge can never disagree.
  const headlineScore = fitComparison?.tailored ?? scoreSource?.score.overall ?? null;
  const scoreContext = fitComparison?.source === "ai"
    ? "AI-judged fit (tailored)"
    : result
    ? "Polished resume score"
    : currentAnalysis
    ? "Live draft score"
    : "Awaiting resume and job target";
  const resultSourceLabel = result?.source === "local" ? "Local engine" : result?.source === "ai" ? "AI" : "";

  return {
    currentAnalysis,
    resumeBulletCount,
    matchBreakdown,
    resumeDiff,
    fitComparison,
    blockStats,
    scoreSource,
    headlineScore,
    scoreContext,
    resultSourceLabel
  };
}
