import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import { buildStageRequestFields, type StageConfig } from "../lib/aiRequest";
import { AI_UNAVAILABLE, ApiError, classifyFailure } from "../lib/failures";
import {
  workflowInputFingerprint,
  workflowRequestIsCurrent,
  type AiStageState as StageState,
} from "../lib/aiWorkflow";
import type { StageAiUsage } from "../lib/aiUsage";
import {
  buildCoverLetterEvidence,
  type CoverLetterTailorResult,
} from "../lib/coverLetterEvidence";
import {
  buildCoverLetterPreflight,
  type CoverLetterDetailKey,
  type CoverLetterDetailValues,
  type CoverLetterPreflight,
} from "../lib/coverLetterPreflight";

type UseCoverLetterArgs = {
  currentCoverLetterText: string;
  currentResumeText: string;
  resumeData: ResumeData | null;
  jobText: string;
  honestContext: string;
  customInstructions: string;
  aiRequest: StageConfig;
  providerReady: boolean;
  providerMessage: string;
  resumeText: string;
  sourceRevision: number;
  candidateName: string;
  // True while the applied tailored letter is still the untouched live document.
  // The editor owns that fact because it owns the pre-tailor snapshot behind it.
  tailorApplied: boolean;
  jobTarget?: { role?: string; company?: string };
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

function tailorResponse(value: unknown): CoverLetterTailorResult | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CoverLetterTailorResult>;
  if (
    candidate.status !== "ready" ||
    typeof candidate.coverLetterText !== "string" ||
    !candidate.coverLetterText.trim() ||
    !Array.isArray(candidate.bodyParagraphs) ||
    !Array.isArray(candidate.evidenceUsed)
  ) {
    return null;
  }
  return candidate as CoverLetterTailorResult;
}

// Owns the whole cover-letter AI workflow: deterministic preflight, the single
// tailoring request, stale-request cancellation, and the result summary. There
// is no plan to approve and no proposal to accept — a valid letter goes straight
// into the editor, and the editor keeps the exact document it replaced.
export function useCoverLetter({
  currentCoverLetterText,
  currentResumeText,
  resumeData,
  jobText,
  honestContext,
  customInstructions,
  aiRequest,
  providerReady,
  providerMessage,
  resumeText,
  sourceRevision,
  candidateName,
  tailorApplied,
  jobTarget,
  onApplyTailored,
  onApplyExternal,
  onUsage,
}: UseCoverLetterArgs) {
  const [coverStatus, setCoverStatus] = useState("");
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  const [coverProgress, setCoverProgress] = useState<StageState>({
    status: "idle",
  });
  const [detailValues, setDetailValues] =
    useState<CoverLetterDetailValues>({});
  const [slotAnswers, setSlotAnswers] = useState<Record<string, string>>({});
  const [lastResult, setLastResult] = useState<CoverLetterTailorResult | null>(
    null,
  );
  const requestGenerationRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);

  const preflight = useMemo<CoverLetterPreflight>(
    () =>
      buildCoverLetterPreflight({
        text: currentCoverLetterText,
        candidateName,
        role: jobTarget?.role,
        company: jobTarget?.company,
        values: detailValues,
        slotAnswers,
      }),
    [
      candidateName,
      currentCoverLetterText,
      jobTarget?.company,
      jobTarget?.role,
      detailValues,
      slotAnswers,
    ],
  );
  const slotLabels = useMemo(
    () =>
      Object.fromEntries(
        preflight.template.userInputSlots.map((slot) => [
          slot.id,
          slot.normalizedPrompt,
        ]),
      ),
    [preflight.template.userInputSlots],
  );
  const evidenceItems = useMemo(
    () =>
      buildCoverLetterEvidence({
        resumeData,
        honestContext,
        slotAnswers,
        slotLabels,
      }),
    [honestContext, resumeData, slotAnswers, slotLabels],
  );
  const inputFingerprint = workflowInputFingerprint({
    currentCoverLetterText,
    currentResumeText,
    resumeText,
    jobText,
    customInstructions,
    aiRequest: buildStageRequestFields(aiRequest),
    resolved: preflight.resolved,
    evidenceItems,
  });
  const requestInputFingerprintRef = useRef(inputFingerprint);
  requestInputFingerprintRef.current = inputFingerprint;

  const invalidateCoverRequest = useCallback(() => {
    requestGenerationRef.current += 1;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    setIsGeneratingCover(false);
  }, []);

  useEffect(() => {
    setDetailValues({});
    setSlotAnswers({});
  }, [jobText, sourceRevision]);

  // The summary and Restore share one lifetime: they last exactly as long as the
  // tailored letter is still the untouched live document.
  useEffect(() => {
    if (!tailorApplied) setLastResult(null);
  }, [tailorApplied]);

  useEffect(() => {
    const hadActiveRequest = requestAbortRef.current !== null;
    invalidateCoverRequest();
    if (hadActiveRequest) {
      setCoverStatus(
        "The letter, resume, job, or AI settings changed. Run Tailor again.",
      );
      setCoverProgress({
        status: "stopped",
        errorHeadline: "Inputs changed",
        error:
          "The previous cover-letter request was cancelled before it produced a letter.",
      });
    }
  }, [inputFingerprint, invalidateCoverRequest]);

  useEffect(
    () => () => {
      requestGenerationRef.current += 1;
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
    },
    [],
  );

  const applyCoverLetter = useCallback(
    (text: string) => {
      invalidateCoverRequest();
      onApplyExternal(text);
      setCoverStatus("");
      setCoverProgress({ status: "idle" });
    },
    [invalidateCoverRequest, onApplyExternal],
  );

  const resetCoverWorkflow = useCallback(() => {
    invalidateCoverRequest();
    setSlotAnswers({});
    setCoverStatus("Inputs changed. Tailor the letter again for this context.");
    setCoverProgress({ status: "idle" });
  }, [invalidateCoverRequest]);

  // New browser requests never ask /api/polish for its compatibility cover leg.
  // Refuse an unexpected legacy result instead of replacing the letter through a
  // path that never ran RoleFit's evidence checks.
  const applyPolishCoverResult = useCallback(
    (result: PolishCoverResult) => {
      if (result.status === "off") return;
      invalidateCoverRequest();
      setCoverStatus(
        result.status === "ok"
          ? "A legacy cover-letter result was not applied. Use Tailor on the Cover letter page."
          : "The legacy cover-letter step failed. The existing letter was kept.",
      );
      setCoverProgress({
        status: "failed",
        errorHeadline: AI_UNAVAILABLE,
        error: "The existing cover letter was not replaced.",
      });
    },
    [invalidateCoverRequest],
  );

  const dismissCoverProgress = useCallback(
    () => setCoverProgress({ status: "idle" }),
    [],
  );

  const updateDetail = useCallback(
    (key: CoverLetterDetailKey, value: string) => {
      setDetailValues((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const updateSlotAnswer = useCallback((slotId: string, value: string) => {
    setSlotAnswers((current) => ({ ...current, [slotId]: value }));
  }, []);

  const beginRequest = useCallback(() => {
    invalidateCoverRequest();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const generation = requestGenerationRef.current;
    const requestFingerprint = requestInputFingerprintRef.current;
    const isCurrent = () =>
      workflowRequestIsCurrent(
        generation,
        requestGenerationRef.current,
        requestFingerprint,
        requestInputFingerprintRef.current,
        controller.signal,
      );
    setIsGeneratingCover(true);
    return { controller, isCurrent };
  }, [invalidateCoverRequest]);

  async function handleTailorCoverLetter() {
    if (!preflight.canTailor) {
      setCoverStatus(
        preflight.blockers[0] ?? "Complete the missing detail first.",
      );
      return;
    }
    if (
      !evidenceItems.some((item) => item.source === "resume") ||
      jobText.trim().length < 40
    ) {
      setCoverStatus("Add your resume and the job description first.");
      return;
    }
    if (!providerReady) {
      setCoverStatus(providerMessage);
      setCoverProgress({
        status: "failed",
        errorHeadline: "Provider unavailable",
        error: providerMessage,
      });
      return;
    }

    const { controller, isCurrent } = beginRequest();
    setCoverStatus("Tailoring this letter…");
    setCoverProgress({
      status: "running",
      note: "Writing from your evidence",
      noteTone: "info",
    });
    try {
      const response = await fetch("/api/cover-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildStageRequestFields(aiRequest),
          sourceCoverLetterText: currentCoverLetterText.trim(),
          jobText,
          customInstructions,
          detailValues,
          resolvedContext: preflight.resolved,
          evidenceItems,
          slotAnswers,
        }),
        signal: controller.signal,
      });
      const raw = await response.json();
      if (!isCurrent()) return;
      if (!response.ok) {
        throw new ApiError(
          raw.error ?? raw.reasons?.[0] ?? "Could not tailor the cover letter.",
          response.status,
        );
      }
      const result = tailorResponse(raw);
      if (!result) {
        throw new ApiError("The tailored cover letter could not be read.", 502);
      }
      setLastResult(result);
      onApplyTailored(result.coverLetterText);
      setCoverStatus(
        `Tailored for ${preflight.resolved.role} at ${preflight.resolved.company}.`,
      );
      setCoverProgress({
        status: "done",
        note: "Letter tailored",
        noteTone: "ok",
      });
      onUsage?.({
        source: "ai",
        ...(result.provider ? { provider: result.provider } : {}),
        ...(result.model ? { model: result.model } : {}),
        ...(result.reasoningEffort
          ? { reasoningEffort: result.reasoningEffort }
          : {}),
        ...(result.attempts ? { attempts: result.attempts } : {}),
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (!isCurrent()) return;
      const failure = classifyFailure(error);
      setCoverStatus(`Cover letter not replaced: ${failure.detail}`);
      setCoverProgress({
        status: "failed",
        errorHeadline: failure.headline,
        error: failure.detail,
      });
      onUsage?.({
        source: "none",
        requestedProvider: aiRequest.provider,
        requestedModel: aiRequest.selectedModel,
        completedAt: new Date().toISOString(),
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
    handleTailorCoverLetter,
    coverProgress,
    dismissCoverProgress,
    preflight,
    detailValues,
    updateDetail,
    slotAnswers,
    updateSlotAnswer,
    evidenceItems,
    lastResult,
  };
}
