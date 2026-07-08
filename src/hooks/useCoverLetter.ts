import { useCallback, useState } from "react";
import { buildStageRequestFields, type StageConfig } from "../lib/aiRequest";
import { ApiError, classifyFailure } from "../lib/failures";
import type { StageState } from "../sections/PolishProgress";
import type { StageAiUsage } from "../lib/aiUsage";

type UseCoverLetterArgs = {
  // Generation input: the CURRENT resume (edited model serialized), so the
  // letter reflects what the user actually has, not a stale base.
  currentResumeText: string;
  jobText: string;
  honestContext: string;
  customInstructions: string;
  aiRequest: StageConfig;
  // Generation fallback only (used when currentResumeText is empty). The letter
  // is a SINGLE owned value — App clears/sets it at the same discrete events it
  // resets `result` (base-resume load, job import, application restore), so there
  // is no auto-reset effect here that could wipe a just-restored letter.
  resumeText: string;
  // Reports this generation's AI-usage attribution to the caller's per-stage
  // tracker (App's pipelineAiUsage.cover), called once per handleGenerateCoverLetter
  // completion — not on the "add resume/job first" early-return, which never
  // attempted anything.
  onUsage?: (usage: StageAiUsage) => void;
};

// Owns the cover letter as a single piece of state, generated ON DEMAND from the
// current resume + job via /api/cover-letter — no full polish required. The
// polish path also feeds this state (App calls setCoverLetterText when a Tailor
// run drafts one), so the Materials view, Copy, and save-to-application all read
// one source. There is no local fallback letter (D011): when the AI letter is
// blanked (server grounding backstop) or the call fails, the card fails plainly
// with Retry and any existing letter is left untouched.
export function useCoverLetter({
  currentResumeText,
  jobText,
  honestContext,
  customInstructions,
  aiRequest,
  resumeText,
  onUsage
}: UseCoverLetterArgs) {
  const [coverLetterText, setCoverLetterText] = useState("");
  const [coverStatus, setCoverStatus] = useState("");
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  // Dock card mirroring the polish/distill progress cards, so a cover-letter
  // generation shows up in the same fixed progress stack instead of only the
  // inline coverStatus line. Independent of coverStatus (which stays for the
  // Materials-tab inline copy) — this feeds the dock only.
  const [coverProgress, setCoverProgress] = useState<StageState>({ status: "idle" });

  // Set or clear the cover letter from an external owner (polish pass,
  // application restore, a fresh-start resume/job swap). Always clears the
  // generation status so a stale "Drafted…" line can't linger under a cleared
  // or replaced letter. handleGenerateCoverLetter sets its own status and does
  // NOT route through this. Also resets the dock card so a stale done/failed
  // card can't outlive a letter that was just replaced out from under it.
  const applyCoverLetter = useCallback((text: string) => {
    setCoverLetterText(text);
    setCoverStatus("");
    setCoverProgress({ status: "idle" });
  }, []);

  const dismissCoverProgress = useCallback(() => setCoverProgress({ status: "idle" }), []);

  async function handleGenerateCoverLetter() {
    const resume = currentResumeText.trim() || resumeText.trim();
    if (resume.length < 80 || jobText.trim().length < 40) {
      setCoverStatus("Add your resume and the job description first.");
      return;
    }
    setIsGeneratingCover(true);
    setCoverStatus("Drafting cover letter...");
    setCoverProgress({ status: "running" });
    try {
      const response = await fetch("/api/cover-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildStageRequestFields(aiRequest),
          resumeText: resume,
          jobText,
          honestContext,
          customInstructions
        })
      });
      const data = await response.json();
      if (!response.ok) throw new ApiError(data.error ?? "Could not generate a cover letter.", response.status);
      const ai = String(data.coverLetterText ?? "").trim();
      if (ai) {
        setCoverLetterText(ai);
        setCoverStatus(
          `Drafted a cover letter${data.model ? ` using ${data.model}` : ""}. Fill in any [add: …] placeholders before sending.`
        );
        setCoverProgress({ status: "done", note: "Drafted with AI", noteTone: "ok" });
        onUsage?.({
          source: "ai",
          ...(typeof data.provider === "string" && data.provider ? { provider: data.provider } : {}),
          ...(typeof data.model === "string" && data.model ? { model: data.model } : {}),
          ...(typeof data.reasoningEffort === "string" && data.reasoningEffort
            ? { reasoningEffort: data.reasoningEffort }
            : {}),
          ...(typeof data.attempts === "number" && Number.isFinite(data.attempts) ? { attempts: data.attempts } : {}),
          completedAt: new Date().toISOString()
        });
      } else {
        // Server blanked an ungrounded AI letter (anti-fabrication backstop).
        // No local draft stands in (D011): fail plainly, keep any existing
        // letter untouched, offer Retry.
        setCoverStatus("The AI draft was set aside for unsupported claims. Retry, or adjust honest context.");
        setCoverProgress({ status: "failed", errorHeadline: "Ungrounded", error: "The AI draft was set aside for unsupported claims." });
        onUsage?.({
          source: "none",
          requestedProvider: aiRequest.provider,
          requestedModel: aiRequest.selectedModel === "custom" ? aiRequest.customModel.trim() : aiRequest.selectedModel,
          completedAt: new Date().toISOString()
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/[.。]\s*$/, "") : "request failed";
      // No local fallback letter (D011): fail plainly with a classified reason.
      const f = classifyFailure(error);
      setCoverStatus(`AI cover letter unavailable: ${message}.`);
      setCoverProgress({ status: "failed", errorHeadline: f.headline, error: f.detail });
      onUsage?.({
        source: "none",
        requestedProvider: aiRequest.provider,
        requestedModel: aiRequest.selectedModel === "custom" ? aiRequest.customModel.trim() : aiRequest.selectedModel,
        completedAt: new Date().toISOString()
      });
    } finally {
      setIsGeneratingCover(false);
    }
  }

  return {
    coverLetterText,
    applyCoverLetter,
    coverStatus,
    isGeneratingCover,
    handleGenerateCoverLetter,
    coverProgress,
    dismissCoverProgress
  };
}
