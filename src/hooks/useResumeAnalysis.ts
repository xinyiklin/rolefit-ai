import { useMemo } from "react";
import {
  analyzeMatchBreakdown,
  analyzeResumeText,
  buildResumeDiff,
  type PolishedResume
} from "../resumeEngine";
import { extractPlainTextFromLatex, type ResumeData } from "../lib/resumeData";
import { looksLikeLatex } from "../lib/resumeFormat";
import type { FitComparison, ResumeBlock, ResumeBlockKind } from "../sections/shared";

type UseResumeAnalysisArgs = {
  resumeText: string;
  combinedJobText: string;
  debouncedResumeText: string;
  debouncedCombinedJobText: string;
  // The current resume as edited in the structured editor (serialized + debounced),
  // falling back to the raw polish output. Drives match/diff/fit so manual edits
  // are scored live. `isEdited` is true once the user has hand-edited the model.
  debouncedCurrentResumeText: string;
  isEdited: boolean;
  // The structured editor model, when seeded. Bullet counts and live-draft
  // scoring prefer it (via its serialization) over the raw source text, which
  // may be LaTeX markup the local engine would misread.
  editedResume: ResumeData | null;
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
  debouncedCurrentResumeText,
  isEdited,
  editedResume,
  result,
  resumeBlocks
}: UseResumeAnalysisArgs) {
  // The current tailored resume text: the edited model when present, else the raw
  // polish output. Used by match/diff/fit so the scores track manual edits.
  const tailoredText = (result ? debouncedCurrentResumeText || result.polishedText : "") || "";
  // Pre-polish live draft: prefer the serialized editor model (clean text) so a
  // LaTeX source is scored on its content, not its markup.
  const liveDraftText = debouncedCurrentResumeText || debouncedResumeText;
  const currentAnalysis = useMemo(() => {
    return debouncedResumeText.trim() && debouncedCombinedJobText.trim()
      ? analyzeResumeText(liveDraftText, debouncedCombinedJobText)
      : null;
  }, [debouncedCombinedJobText, debouncedResumeText, liveDraftText]);

  const resumeBulletCount = useMemo(() => {
    if (editedResume) {
      return editedResume.sections.reduce(
        (count, section) =>
          // Skills rows and summary paragraphs live in entry/bullet slots but
          // aren't bullets (the text fallback below counts only "- " lines).
          section.type === "skills" || section.type === "summary"
            ? count
            : count +
              section.items.reduce((c, item) => c + item.bullets.filter((b) => b.text.trim()).length, 0),
        0
      );
    }
    return resumeText.split("\n").filter((line) => /^\s*[-*•]\s+/.test(line)).length;
  }, [editedResume, resumeText]);

  const matchBreakdown = useMemo(() => {
    const sourceText = result ? tailoredText : liveDraftText;
    const jobText = result ? combinedJobText : debouncedCombinedJobText;
    return jobText.trim() ? analyzeMatchBreakdown(sourceText, jobText) : [];
  }, [combinedJobText, debouncedCombinedJobText, liveDraftText, result, tailoredText]);

  // Diff against the base resume's CONTENT: a LaTeX source is reduced to plain
  // text first so the before/after reads as wording changes, not markup noise.
  const basePlainText = useMemo(
    () =>
      looksLikeLatex(resumeText) ? extractPlainTextFromLatex(resumeText) || resumeText : resumeText,
    [resumeText]
  );

  const resumeDiff = useMemo(
    () => (result ? buildResumeDiff(basePlainText, tailoredText) : null),
    [result, basePlainText, tailoredText]
  );

  // Base (original resume) vs. tailored (polished) fit. Prefer the AI's
  // same-call comparison when present; otherwise score the original resume with
  // the local engine so the before/after still works without AI. `resumeText`
  // stays the original after a polish (the tailored copy lives in result), so it
  // is the base to score against.
  const fitComparison = useMemo<FitComparison | null>(() => {
    if (!result) return null;
    // Once the resume is hand-edited, the AI/saved tailored numbers no longer
    // describe the current text — recompute the tailored score locally so the
    // headline tracks edits and never relabels an edited resume as AI-judged.
    if (!isEdited) {
      if (result.aiScore) {
        return { source: "ai", base: result.aiScore.base, tailored: result.aiScore.tailored, reason: result.aiScore.liftReason };
      }
      // Restored from a pipeline snapshot — carry the saved numbers and their
      // original provenance instead of recomputing (we no longer have the base).
      if (result.savedFit) {
        return { source: result.savedFit.source, base: result.savedFit.base, tailored: result.savedFit.tailored, reason: "" };
      }
    }
    if (!combinedJobText.trim()) return null;
    // Score the base on its content (same de-LaTeXed text the diff uses) so
    // markup noise doesn't depress the base and inflate the lift.
    const baseScore = analyzeResumeText(basePlainText, combinedJobText).score.overall;
    const tailoredScore = isEdited
      ? analyzeResumeText(tailoredText, combinedJobText).score.overall
      : result.score.overall;
    return { source: "local", base: baseScore, tailored: tailoredScore, reason: "" };
  }, [result, basePlainText, combinedJobText, isEdited, tailoredText]);

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
  // State-aware fallback: name the input that is actually missing instead of
  // a blanket "awaiting resume and job target" (the resume often auto-loads).
  const hasResumeText = resumeText.trim().length > 0;
  const hasJobText = combinedJobText.trim().length > 0;
  const scoreContext = fitComparison?.source === "ai"
    ? "AI-judged fit (tailored)"
    : result
    ? "Polished resume score"
    : currentAnalysis
    ? "Live draft score"
    : hasResumeText && !hasJobText
    ? ""
    : hasJobText && !hasResumeText
    ? "Add a resume to begin"
    : "Add a resume and a job target";
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
