import { useMemo } from "react";
import { analyzeResumeText, buildResumeDiff, type PolishedResume } from "../resumeEngine";
import { extractPlainTextFromLatex } from "../lib/resumeData";
import { stripInlineMarks } from "../lib/inlineMarks";
import { looksLikeLatex } from "../lib/resumeFormat";
import { extractJobConstraints } from "../lib/jobConstraints";
import { VERDICT_LABEL, verdictFromScore, verdictPillClass } from "../lib/fitVerdict";
import type { StrictReviewVerdict } from "../resume/types";
import type { FitComparison } from "../sections/shared";

export { verdictPillClass };

// What the user actually needs at a glance: a fit VERDICT, not a number. The
// header shows the same four bands the review rail and tracker use — one shared
// vocabulary (lib/fitVerdict.ts). When strict review ran we surface its real
// (gap-capped, blocker-aware) verdict; otherwise we derive a band from the score
// — qualified as "Estimated" so the weaker local-keyword provenance is honest.
export type FitVerdict = { verdict: StrictReviewVerdict; label: string; source: "AI-judged" | "Estimated" };

type UseResumeAnalysisArgs = {
  resumeText: string;
  jobDescription: string;
  debouncedResumeText: string;
  debouncedJobDescription: string;
  // The current resume as edited in the structured editor (serialized + debounced),
  // falling back to the raw polish output. Drives match/diff/fit so manual edits
  // are scored live. `isEdited` is true once the user has FREELY hand-edited the
  // model — accepting/undoing a reviewed suggestion does NOT set it, since the AI
  // verdict still describes that proposal (see useResumeEditor `manualEdited`).
  debouncedCurrentResumeText: string;
  isEdited: boolean;
  result: PolishedResume | null;
};

// Pure, read-only derivation of every score/diff/match value the UI shows.
// Takes the raw + debounced inputs and the current polish result and returns
// the memoized derivations — it owns no state and triggers no effects, so it
// has no coupling back to App's setters (unlike the resume-source/polish
// handlers, which stay in App).
export function useResumeAnalysis({
  resumeText,
  jobDescription,
  debouncedResumeText,
  debouncedJobDescription,
  debouncedCurrentResumeText,
  isEdited,
  result
}: UseResumeAnalysisArgs) {
  // The current tailored resume text: the edited model when present, else the raw
  // polish output. Used by match/diff/fit so the scores track manual edits.
  const tailoredText = (result ? debouncedCurrentResumeText || result.polishedText : "") || "";
  // Pre-polish live draft: prefer the serialized editor model (clean text) so a
  // LaTeX source is scored on its content, not its markup.
  const liveDraftText = debouncedCurrentResumeText || debouncedResumeText;
  const currentAnalysis = useMemo(() => {
    return debouncedResumeText.trim() && debouncedJobDescription.trim()
      ? analyzeResumeText(liveDraftText, debouncedJobDescription)
      : null;
  }, [debouncedJobDescription, debouncedResumeText, liveDraftText]);

  // Diff against the base resume's CONTENT: a LaTeX source is reduced to plain
  // text first so the before/after reads as wording changes, not markup noise.
  const basePlainText = useMemo(
    () =>
      looksLikeLatex(resumeText) ? extractPlainTextFromLatex(resumeText) || resumeText : resumeText,
    [resumeText]
  );

  // Strip inline marks (<b>/<i>/<u>) from both sides so the diff reads as
  // wording changes, not markup noise, and a tag split across diff segments
  // can't leak a raw "<b>" (or an unclosed bold) into the rendered diff.
  const resumeDiff = useMemo(
    () =>
      result ? buildResumeDiff(stripInlineMarks(basePlainText), stripInlineMarks(tailoredText)) : null,
    [result, basePlainText, tailoredText]
  );

  // Base (original resume) vs. tailored (polished) fit. Prefer the AI's
  // same-call comparison when present; otherwise score the original resume with
  // the local engine so the before/after still works without AI. `resumeText`
  // stays the original after a polish (the tailored copy lives in result), so it
  // is the base to score against.
  const fitComparison = useMemo<FitComparison | null>(() => {
    if (!result) return null;
    // Once the resume is FREELY hand-edited, the AI/saved tailored numbers no
    // longer describe the current text — recompute the tailored score locally so
    // the headline tracks edits and never relabels a freely-edited resume as
    // AI-judged. Applying the AI's own reviewed suggestions is not a free edit.
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
    if (!jobDescription.trim()) return null;
    // Score the base on its content (same de-LaTeXed text the diff uses) so
    // markup noise doesn't depress the base and inflate the lift.
    const baseScore = analyzeResumeText(basePlainText, jobDescription).score.overall;
    const tailoredScore = isEdited
      ? analyzeResumeText(tailoredText, jobDescription).score.overall
      : result.score.overall;
    return { source: "local", base: baseScore, tailored: tailoredScore, reason: "" };
  }, [result, basePlainText, jobDescription, isEdited, tailoredText]);

  const scoreSource = result ?? currentAnalysis;
  // Headline FIT: the tailored score from the comparison (AI when present, else
  // local/restored), falling back to the live-draft local overall. Same 0-100
  // scale either way. Derived from fitComparison so headline, hero, and tab
  // badge can never disagree.
  const headlineScore = fitComparison?.tailored ?? scoreSource?.score.overall ?? null;
  // State-aware fallback: name the input that is actually missing instead of
  // a blanket "awaiting resume and job target" (the resume often auto-loads).
  const hasResumeText = resumeText.trim().length > 0;
  const hasJobText = jobDescription.trim().length > 0;
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

  // Fit verdict band for the header — the qualitative "are they a fit?" signal.
  // When the user FREELY hand-edits the resume after the AI reviewed it, the
  // stored AI verdict no longer describes the current text (the score already
  // re-derives from the edited content via fitComparison). Mirror the same
  // isEdited gate that fitComparison uses so the label source stays honest.
  // Accepting the AI's reviewed suggestions keeps "AI-judged" — the verdict
  // describes that very proposal, so applying it does not flip to "Estimated".
  const fitVerdict = useMemo<FitVerdict | null>(() => {
    const aiVerdict = result?.strictReview?.verdict;
    if (aiVerdict && VERDICT_LABEL[aiVerdict] && !isEdited) {
      return { verdict: aiVerdict, label: VERDICT_LABEL[aiVerdict], source: "AI-judged" };
    }
    const derived = verdictFromScore(headlineScore);
    return derived ? { verdict: derived, label: VERDICT_LABEL[derived], source: "Estimated" } : null;
  }, [result, headlineScore, isEdited]);

  // Lifestyle/logistical conditions in the JD — surfaced as a pre-apply advisory,
  // deliberately NOT a fit input (the prompt rules keep the verdict about
  // qualifications). Deterministic from the job text, so it's available whether
  // or not strict review ran.
  const jobConstraints = useMemo(() => extractJobConstraints(jobDescription), [jobDescription]);

  return {
    resumeDiff,
    fitComparison,
    headlineScore,
    scoreContext,
    fitVerdict,
    jobConstraints,
    resultSourceLabel
  };
}
