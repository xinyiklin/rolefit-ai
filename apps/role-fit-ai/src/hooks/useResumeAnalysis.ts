import { useMemo } from "react";
import { buildResumeDiff, type PolishedResume } from "../resumeEngine";
import { stripInlineMarks } from "../lib/inlineMarks";
import { extractJobConstraints } from "../lib/jobConstraints";

type UseResumeAnalysisArgs = {
  resumeText: string;
  jobDescription: string;
  // The current resume as edited in the structured editor (serialized + debounced),
  // falling back to the raw polish output. Drives the before/after diff. `isEdited`
  // is true once the user has FREELY hand-edited the model — accepting/undoing a
  // reviewed suggestion does NOT set it, since the submission assessment still
  // describes that proposal (see useResumeEditor `manualEdited`).
  debouncedCurrentResumeText: string;
  result: PolishedResume | null;
};

// Pure, read-only derivation of the diff and deterministic advisories the UI shows.
// Takes the raw + debounced inputs and the current polish result and returns
// the memoized derivations — it owns no state and triggers no effects, so it
// has no coupling back to App's setters (unlike the resume-source/polish
// handlers, which stay in App).
export function useResumeAnalysis({
  resumeText,
  jobDescription,
  debouncedCurrentResumeText,
  result
}: UseResumeAnalysisArgs) {
  // The current tailored resume text: the edited model when present, else the raw
  // polish output. Used by the diff; free-form edits invalidate saved readiness.
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

  // Lifestyle/logistical conditions in the JD — surfaced as a pre-apply advisory,
  // deliberately NOT a fit input (the prompt rules keep the verdict about
  // qualifications). Deterministic from the job text, so it's available whether
  // or not submission review ran.
  const jobConstraints = useMemo(() => extractJobConstraints(jobDescription), [jobDescription]);

  return {
    resumeDiff,
    jobConstraints
  };
}
