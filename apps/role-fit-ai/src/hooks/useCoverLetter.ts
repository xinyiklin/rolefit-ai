import { useCallback, useEffect, useRef, useState } from "react";
import { buildStageRequestFields, type StageConfig } from "../lib/aiRequest";
import { AI_UNAVAILABLE, ApiError, classifyFailure } from "../lib/failures";
import {
  workflowInputFingerprint,
  workflowRequestIsCurrent,
  type AiStageState as StageState
} from "../lib/aiWorkflow";
import type { StageAiUsage } from "../lib/aiUsage";

type UseCoverLetterArgs = {
  currentCoverLetterText: string;
  currentResumeText: string;
  jobText: string;
  honestContext: string;
  customInstructions: string;
  aiRequest: StageConfig;
  providerReady: boolean;
  providerMessage: string;
  resumeText: string;
  onCaptureSource: () => void;
  onApplyTailored: (text: string) => void;
  onApplyExternal: (text: string) => void;
  onUsage?: (usage: StageAiUsage) => void;
};

export type PolishCoverResult = {
  status: "off" | "ok" | "failed";
  coverLetterText?: string;
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  attempts?: number;
};

// Owns the single grounded AI revision request. The editable cover-letter
// document lives in useCoverLetterEditor; this hook never manufactures an
// initial draft and never keeps a competing text copy.
export function useCoverLetter({
  currentCoverLetterText,
  currentResumeText,
  jobText,
  honestContext,
  customInstructions,
  aiRequest,
  providerReady,
  providerMessage,
  resumeText,
  onCaptureSource,
  onApplyTailored,
  onApplyExternal,
  onUsage
}: UseCoverLetterArgs) {
  const [coverStatus, setCoverStatus] = useState("");
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  const [coverProgress, setCoverProgress] = useState<StageState>({ status: "idle" });
  const requestGenerationRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const inputFingerprint = workflowInputFingerprint({
    currentCoverLetterText,
    currentResumeText,
    resumeText,
    jobText,
    honestContext,
    customInstructions,
    aiRequest: buildStageRequestFields(aiRequest)
  });
  const inputFingerprintRef = useRef(inputFingerprint);
  inputFingerprintRef.current = inputFingerprint;

  const invalidateCoverRequest = useCallback(() => {
    requestGenerationRef.current += 1;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    setIsGeneratingCover(false);
  }, []);

  useEffect(() => {
    const hadActiveRequest = requestAbortRef.current !== null;
    invalidateCoverRequest();
    if (hadActiveRequest) {
      setCoverStatus("The letter, resume, job, or AI settings changed. Start a new tailoring pass.");
      setCoverProgress({
        status: "stopped",
        errorHeadline: "Inputs changed",
        error: "The previous cover-letter request was cancelled before it could replace this draft."
      });
    }
  }, [inputFingerprint, invalidateCoverRequest]);

  useEffect(() => () => {
    requestGenerationRef.current += 1;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
  }, []);

  // External restoration/clearing remains an intent-level action for App.
  const applyCoverLetter = useCallback((text: string) => {
    invalidateCoverRequest();
    onApplyExternal(text);
    setCoverStatus("");
    setCoverProgress({ status: "idle" });
  }, [invalidateCoverRequest, onApplyExternal]);

  // Resume/job context changes invalidate AI provenance, but the candidate's
  // authored letter is independent user data and must not be discarded.
  const resetCoverWorkflow = useCallback(() => {
    invalidateCoverRequest();
    setCoverStatus("Inputs changed. Tailor the current cover letter again for this context.");
    setCoverProgress({ status: "idle" });
  }, [invalidateCoverRequest]);

  // Kept as a compatibility receiver while the legacy optional cover result is
  // removed from the resume Polish protocol. New UI never requests that pass.
  const applyPolishCoverResult = useCallback((result: PolishCoverResult) => {
    if (result.status === "off") return;
    invalidateCoverRequest();
    const text = result.coverLetterText?.trim() ?? "";
    if (result.status === "ok" && text) {
      onApplyTailored(text);
      setCoverStatus("Tailored the existing cover letter during Polish. Review it before sending.");
      setCoverProgress({ status: "done", note: "Tailored with AI", noteTone: "ok" });
      return;
    }
    setCoverStatus("The cover-letter step failed. The existing letter was kept.");
    setCoverProgress({
      status: "failed",
      errorHeadline: AI_UNAVAILABLE,
      error: "The existing cover letter was not replaced."
    });
  }, [invalidateCoverRequest, onApplyTailored]);

  const dismissCoverProgress = useCallback(() => setCoverProgress({ status: "idle" }), []);

  async function handleGenerateCoverLetter() {
    invalidateCoverRequest();
    const sourceCoverLetterText = currentCoverLetterText.trim();
    const resume = currentResumeText.trim() || resumeText.trim();
    if (sourceCoverLetterText.length < 80) {
      setCoverStatus("Open your own cover letter before tailoring it.");
      return;
    }
    if (resume.length < 80 || jobText.trim().length < 40) {
      setCoverStatus("Add your resume and the job description first.");
      return;
    }
    if (!providerReady) {
      setCoverStatus(providerMessage);
      setCoverProgress({
        status: "failed",
        errorHeadline: "Provider unavailable",
        error: providerMessage
      });
      return;
    }

    onCaptureSource();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const generation = requestGenerationRef.current;
    const requestFingerprint = inputFingerprintRef.current;
    const isCurrent = () => workflowRequestIsCurrent(
      generation,
      requestGenerationRef.current,
      requestFingerprint,
      inputFingerprintRef.current,
      controller.signal
    );
    setIsGeneratingCover(true);
    setCoverStatus("Tailoring your cover letter…");
    setCoverProgress({ status: "running" });

    try {
      const response = await fetch("/api/cover-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildStageRequestFields(aiRequest),
          sourceCoverLetterText,
          resumeText: resume,
          jobText,
          honestContext,
          customInstructions
        }),
        signal: controller.signal
      });
      const data = await response.json();
      if (!isCurrent()) return;
      if (!response.ok) {
        throw new ApiError(data.error ?? "Could not tailor the cover letter.", response.status);
      }
      const tailored = String(data.coverLetterText ?? "").trim();
      if (!tailored) {
        setCoverStatus("The AI revision was set aside for unsupported claims. Your letter was kept.");
        setCoverProgress({
          status: "failed",
          errorHeadline: "Ungrounded",
          error: "The AI revision was set aside for unsupported claims."
        });
        onUsage?.({
          source: "none",
          requestedProvider: aiRequest.provider,
          requestedModel: aiRequest.selectedModel,
          completedAt: new Date().toISOString()
        });
        return;
      }

      onApplyTailored(tailored);
      setCoverStatus(
        `Tailored your letter${data.model ? ` using ${data.model}` : ""}. Compare it with the recoverable source and review every claim.`
      );
      setCoverProgress({ status: "done", note: "Tailored with AI", noteTone: "ok" });
      onUsage?.({
        source: "ai",
        ...(typeof data.provider === "string" && data.provider ? { provider: data.provider } : {}),
        ...(typeof data.model === "string" && data.model ? { model: data.model } : {}),
        ...(typeof data.reasoningEffort === "string" && data.reasoningEffort
          ? { reasoningEffort: data.reasoningEffort }
          : {}),
        ...(typeof data.attempts === "number" && Number.isFinite(data.attempts)
          ? { attempts: data.attempts }
          : {}),
        completedAt: new Date().toISOString()
      });
    } catch (error) {
      if (!isCurrent()) return;
      const failure = classifyFailure(error);
      setCoverStatus(`AI cover-letter tailoring unavailable: ${failure.detail}`);
      setCoverProgress({
        status: "failed",
        errorHeadline: failure.headline,
        error: failure.detail
      });
      onUsage?.({
        source: "none",
        requestedProvider: aiRequest.provider,
        requestedModel: aiRequest.selectedModel,
        completedAt: new Date().toISOString()
      });
    } finally {
      if (isCurrent()) {
        requestAbortRef.current = null;
        setIsGeneratingCover(false);
      }
    }
  }

  return {
    coverLetterText: currentCoverLetterText,
    applyCoverLetter,
    resetCoverWorkflow,
    applyPolishCoverResult,
    coverStatus,
    isGeneratingCover,
    handleGenerateCoverLetter,
    coverProgress,
    dismissCoverProgress
  };
}
