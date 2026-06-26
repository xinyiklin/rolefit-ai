import { useCallback, useState } from "react";
import { buildAiRequestFields, type AiRequestSettings } from "../lib/aiRequest";
import { draftCoverLetter } from "../resumeEngine";

type UseCoverLetterArgs = {
  // Generation input: the CURRENT resume (edited model serialized), so the
  // letter reflects what the user actually has, not a stale base.
  currentResumeText: string;
  jobText: string;
  honestContext: string;
  customInstructions: string;
  aiRequest: AiRequestSettings;
  // Generation fallback only (used when currentResumeText is empty). The letter
  // is a SINGLE owned value — App clears/sets it at the same discrete events it
  // resets `result` (base-resume load, job import, application restore), so there
  // is no auto-reset effect here that could wipe a just-restored letter.
  resumeText: string;
  // Distilled JD facts so the local fallback draft can name the target company
  // and role instead of leaving [Company]/[role title] placeholders. Empty when
  // the distiller could not ground them; the draft keeps the placeholders then.
  jobCompany?: string;
  jobRoleTitle?: string;
};

// Owns the cover letter as a single piece of state, generated ON DEMAND from the
// current resume + job via /api/cover-letter — no full polish required. The
// polish path also feeds this state (App calls setCoverLetterText when a Tailor
// run drafts one), so the Materials view, Copy, and save-to-application all read
// one source. Always leaves the user with a usable draft: if the AI letter is
// blanked (server grounding backstop) or the call fails, it falls back to the
// deterministic, strictly-grounded local draftCoverLetter.
export function useCoverLetter({
  currentResumeText,
  jobText,
  honestContext,
  customInstructions,
  aiRequest,
  resumeText,
  jobCompany,
  jobRoleTitle
}: UseCoverLetterArgs) {
  // Shared by both fallback paths below so a known company/role is named even
  // when the AI letter is blanked or the call fails.
  const localDraftMeta = { company: jobCompany, roleTitle: jobRoleTitle };
  const [coverLetterText, setCoverLetterText] = useState("");
  const [coverStatus, setCoverStatus] = useState("");
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);

  // Set or clear the cover letter from an external owner (polish pass,
  // application restore, a fresh-start resume/job swap). Always clears the
  // generation status so a stale "Drafted…" line can't linger under a cleared
  // or replaced letter. handleGenerateCoverLetter sets its own status and does
  // NOT route through this.
  const applyCoverLetter = useCallback((text: string) => {
    setCoverLetterText(text);
    setCoverStatus("");
  }, []);

  async function handleGenerateCoverLetter() {
    const resume = currentResumeText.trim() || resumeText.trim();
    if (resume.length < 80 || jobText.trim().length < 40) {
      setCoverStatus("Add your resume and the job description first.");
      return;
    }
    setIsGeneratingCover(true);
    setCoverStatus("Drafting cover letter...");
    try {
      const response = await fetch("/api/cover-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildAiRequestFields(aiRequest),
          resumeText: resume,
          jobText,
          honestContext,
          customInstructions
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not generate a cover letter.");
      const ai = String(data.coverLetterText ?? "").trim();
      if (ai) {
        setCoverLetterText(ai);
        setCoverStatus(
          `Drafted a cover letter${data.model ? ` using ${data.model}` : ""}. Fill in any [add: …] placeholders before sending.`
        );
      } else {
        // Server blanked an ungrounded AI letter — fall back to the local,
        // strictly-grounded draft (the same backstop the polish cover pass uses).
        setCoverLetterText(draftCoverLetter(resume, jobText, resume, localDraftMeta));
        setCoverStatus("Drafted a local cover letter (the AI draft was set aside for unsupported claims). Fill in the [add: …] placeholders.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/[.。]\s*$/, "") : "request failed";
      // Always leave a usable draft: the deterministic local one.
      setCoverLetterText(draftCoverLetter(resume, jobText, resume, localDraftMeta));
      setCoverStatus(`AI cover letter unavailable: ${message}. Showing a local draft to edit.`);
    } finally {
      setIsGeneratingCover(false);
    }
  }

  return { coverLetterText, applyCoverLetter, coverStatus, isGeneratingCover, handleGenerateCoverLetter };
}
