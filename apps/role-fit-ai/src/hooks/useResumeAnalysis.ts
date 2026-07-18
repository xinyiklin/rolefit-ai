import { useMemo } from "react";
import { buildResumeDiff, type PolishedResume } from "../resumeEngine";
import { stripInlineMarks } from "../lib/inlineMarks";
import { extractJobConstraints } from "../lib/jobConstraints";
import type { FitComparison } from "../sections/shared";

type UseResumeAnalysisArgs = {
  resumeText: string;
  jobDescription: string;
  // The current resume as edited in the structured editor (serialized + debounced),
  // falling back to the raw polish output. Drives the before/after diff. `isEdited`
  // is true once the user has FREELY hand-edited the model — accepting/undoing a
  // reviewed suggestion does NOT set it, since the AI verdict still describes
  // that proposal (see useResumeEditor `manualEdited`).
  debouncedCurrentResumeText: string;
  isEdited: boolean;
  result: PolishedResume | null;
};

// Pure, read-only derivation of every AI score/diff/advisory value the UI shows.
// Takes the raw + debounced inputs and the current polish result and returns
// the memoized derivations — it owns no state and triggers no effects, so it
// has no coupling back to App's setters (unlike the resume-source/polish
// handlers, which stay in App).
export function useResumeAnalysis({
  resumeText,
  jobDescription,
  debouncedCurrentResumeText,
  isEdited,
  result
}: UseResumeAnalysisArgs) {
  // The current tailored resume text: the edited model when present, else the raw
  // polish output. Used by the diff; free-form edits invalidate the saved AI fit.
  const tailoredText = (result ? debouncedCurrentResumeText || result.polishedText : "") || "";
  // Diff against the base resume's content, as-is.
  const basePlainText = resumeText;

  // Strip inline marks (<b>/<i>/<u>) from both sides so the diff reads as
  // wording changes, not markup noise, and a tag split across diff segments
  // can't leak a raw "<b>" (or an unclosed bold) into the rendered diff.
  const resumeDiff = useMemo(
    () =>
      result ? buildResumeDiff(stripInlineMarks(basePlainText), stripInlineMarks(tailoredText)) : null,
    [result, basePlainText, tailoredText]
  );

  // Base (original resume) vs. tailored (polished) fit comes only from AI Review.
  // Once free-form edits make that judgment stale, show no score until Review is
  // run again. Never substitute a deterministic estimate under AI review UI.
  const fitComparison = useMemo<FitComparison | null>(() => {
    if (!result || isEdited) return null;
    if (result.aiScore) {
      return { source: "ai", base: result.aiScore.base, tailored: result.aiScore.tailored, reason: result.aiScore.liftReason };
    }
    if (result.savedFit?.source === "ai") {
      return { source: "ai", base: result.savedFit.base, tailored: result.savedFit.tailored, reason: "" };
    }
    return null;
  }, [result, isEdited]);

  // Tailored score saved with the application. The visible verdict belongs in
  // the review rail, where its reason and evidence are available, rather than
  // being duplicated in the editor toolbar.
  const headlineScore = fitComparison?.tailored ?? null;
  const resultSourceLabel = result?.source === "ai" ? "AI" : "";

  // Lifestyle/logistical conditions in the JD — surfaced as a pre-apply advisory,
  // deliberately NOT a fit input (the prompt rules keep the verdict about
  // qualifications). Deterministic from the job text, so it's available whether
  // or not strict review ran.
  const jobConstraints = useMemo(() => extractJobConstraints(jobDescription), [jobDescription]);

  return {
    resumeDiff,
    fitComparison,
    headlineScore,
    jobConstraints,
    resultSourceLabel
  };
}
