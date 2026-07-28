import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import { buildStageRequestFields, type StageConfig } from "../lib/aiRequest";
import { AI_UNAVAILABLE, ApiError, classifyFailure } from "../lib/failures";
import {
  workflowInputFingerprint,
  workflowRequestIsCurrent,
  type AiStageState as StageState
} from "../lib/aiWorkflow";
import type { StageAiUsage } from "../lib/aiUsage";
import {
  buildCoverLetterEvidence,
  selectedEvidenceForPlan,
  type CoverLetterPlan,
  type CoverLetterPreparation,
  type CoverLetterProposal,
  type EvidenceDecision
} from "../lib/coverLetterEvidence";
import {
  buildCoverLetterPreflight,
  type CoverLetterPreparationFieldKey,
  type CoverLetterPreparationValues,
  type CoverLetterPreflight,
  type CoverLetterSourceMode
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
  sourceMode: CoverLetterSourceMode;
  sourceRevision: number;
  candidateName: string;
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

type PreparationResponse = CoverLetterPreparation & {
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  attempts?: number;
};

function preparationResponse(value: unknown): PreparationResponse | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PreparationResponse>;
  if (
    (candidate.status !== "ready" && candidate.status !== "needs_input") ||
    !candidate.plan ||
    !Array.isArray(candidate.plan.decisions) ||
    !Array.isArray(candidate.clarifications)
  ) {
    return null;
  }
  return candidate as PreparationResponse;
}

function proposalResponse(value: unknown): CoverLetterProposal | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CoverLetterProposal>;
  if (
    candidate.status !== "ready" ||
    candidate.readyToSend !== true ||
    typeof candidate.coverLetterText !== "string" ||
    !candidate.coverLetterText.trim() ||
    !Array.isArray(candidate.blocks) ||
    !Array.isArray(candidate.selectedEvidence)
  ) {
    return null;
  }
  return candidate as CoverLetterProposal;
}

function evidenceDecisionWithOverride(
  decision: EvidenceDecision,
  nextDecision: "use" | "skip"
): EvidenceDecision {
  return {
    ...decision,
    decision: nextDecision,
    reason: nextDecision === "use" ? "Included by the candidate." : "Skipped by the candidate.",
    userOverridden: true,
    question: undefined
  };
}

// Owns the complete cover-letter AI workflow: deterministic preflight,
// preparation, clarification, evidence overrides, selected-evidence-only
// drafting, cancellation, and the pending proposal. The editable document
// remains solely in useCoverLetterEditor until explicit acceptance.
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
  sourceMode,
  sourceRevision,
  candidateName,
  jobTarget,
  onApplyTailored,
  onApplyExternal,
  onUsage
}: UseCoverLetterArgs) {
  const [coverStatus, setCoverStatus] = useState("");
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  const [coverProgress, setCoverProgress] = useState<StageState>({ status: "idle" });
  const [preparationValues, setPreparationValues] = useState<CoverLetterPreparationValues>({});
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({});
  const [preparation, setPreparation] = useState<CoverLetterPreparation | null>(null);
  const [pendingProposal, setPendingProposal] = useState<CoverLetterProposal | null>(null);
  const requestGenerationRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);

  const preflight = useMemo<CoverLetterPreflight>(
    () =>
      buildCoverLetterPreflight({
        text: currentCoverLetterText,
        sourceMode,
        candidateName,
        role: jobTarget?.role,
        company: jobTarget?.company,
        values: preparationValues
      }),
    [
      candidateName,
      currentCoverLetterText,
      jobTarget?.company,
      jobTarget?.role,
      preparationValues,
      sourceMode
    ]
  );
  const baseEvidence = useMemo(
    () =>
      buildCoverLetterEvidence({
        resumeData,
        honestContext,
        preparationValues
      }),
    [honestContext, preparationValues, resumeData]
  );
  const evidenceItems = useMemo(
    () =>
      buildCoverLetterEvidence({
        resumeData,
        honestContext,
        preparationValues,
        clarificationAnswers
      }),
    [clarificationAnswers, honestContext, preparationValues, resumeData]
  );
  const inputFingerprint = workflowInputFingerprint({
    currentCoverLetterText,
    currentResumeText,
    resumeText,
    jobText,
    customInstructions,
    aiRequest: buildStageRequestFields(aiRequest),
    preflight,
    baseEvidence
  });
  const requestInputFingerprint = workflowInputFingerprint({
    inputFingerprint,
    clarificationAnswers,
    preparation
  });
  const requestInputFingerprintRef = useRef(requestInputFingerprint);
  requestInputFingerprintRef.current = requestInputFingerprint;

  const invalidateCoverRequest = useCallback(() => {
    requestGenerationRef.current += 1;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    setIsGeneratingCover(false);
  }, []);

  useEffect(() => {
    setPreparationValues({});
    setClarificationAnswers({});
    setPreparation(null);
    setPendingProposal(null);
  }, [jobText, sourceRevision]);

  useEffect(() => {
    const hadActiveRequest = requestAbortRef.current !== null;
    invalidateCoverRequest();
    setPreparation(null);
    setPendingProposal(null);
    if (hadActiveRequest) {
      setCoverStatus("The letter, resume, job, or AI settings changed. Start a new preparation pass.");
      setCoverProgress({
        status: "stopped",
        errorHeadline: "Inputs changed",
        error: "The previous cover-letter request was cancelled before it could produce a proposal."
      });
    }
  }, [inputFingerprint, invalidateCoverRequest]);

  useEffect(
    () => () => {
      requestGenerationRef.current += 1;
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
    },
    []
  );

  const applyCoverLetter = useCallback(
    (text: string) => {
      invalidateCoverRequest();
      setPreparation(null);
      setPendingProposal(null);
      onApplyExternal(text);
      setCoverStatus("");
      setCoverProgress({ status: "idle" });
    },
    [invalidateCoverRequest, onApplyExternal]
  );

  const resetCoverWorkflow = useCallback(() => {
    invalidateCoverRequest();
    setClarificationAnswers({});
    setPreparation(null);
    setPendingProposal(null);
    setCoverStatus("Inputs changed. Prepare the current cover letter again for this context.");
    setCoverProgress({ status: "idle" });
  }, [invalidateCoverRequest]);

  // New browser requests never ask /api/polish for its compatibility cover leg.
  // Refuse an unexpected legacy result instead of bypassing preparation and the
  // explicit proposal acceptance contract.
  const applyPolishCoverResult = useCallback(
    (result: PolishCoverResult) => {
      if (result.status === "off") return;
      invalidateCoverRequest();
      setCoverStatus(
        result.status === "ok"
          ? "A legacy cover-letter result was not applied. Use the Cover letter page to prepare it safely."
          : "The legacy cover-letter step failed. The existing letter was kept."
      );
      setCoverProgress({
        status: "failed",
        errorHeadline: AI_UNAVAILABLE,
        error: "The existing cover letter was not replaced."
      });
    },
    [invalidateCoverRequest]
  );

  const dismissCoverProgress = useCallback(() => setCoverProgress({ status: "idle" }), []);

  const updatePreparationField = useCallback(
    (key: CoverLetterPreparationFieldKey, value: string) => {
      setPreparationValues((current) => ({ ...current, [key]: value }));
    },
    []
  );

  const updateClarificationAnswer = useCallback(
    (evidenceId: string, value: string) => {
      const hadActiveRequest = requestAbortRef.current !== null;
      invalidateCoverRequest();
      setClarificationAnswers((current) => ({ ...current, [evidenceId]: value }));
      if (hadActiveRequest) {
        setCoverStatus("A clarification changed while the request was running. Update the plan again.");
        setCoverProgress({
          status: "stopped",
          errorHeadline: "Clarification changed",
          error: "The stale response was cancelled and the existing evidence plan was kept."
        });
      }
    },
    [invalidateCoverRequest]
  );

  const updateEvidenceDecision = useCallback(
    (evidenceId: string, nextDecision: "use" | "skip") => {
      if (!preparation) return;
      const selectedCount = preparation.plan.decisions.filter(
          (decision) => decision.decision === "use" && decision.evidenceId !== evidenceId
      ).length;
      if (nextDecision === "use" && selectedCount >= 3) {
        setCoverStatus("Choose no more than three evidence items.");
        return;
      }
      invalidateCoverRequest();
      setPendingProposal(null);
      setPreparation((current) => {
        if (!current) return current;
        const plan: CoverLetterPlan = {
          ...current.plan,
          decisions: current.plan.decisions.map((decision) =>
            decision.evidenceId === evidenceId
              ? evidenceDecisionWithOverride(decision, nextDecision)
              : decision
          )
        };
        const remainingClarifications = current.clarifications.filter(
          (field) => field.evidenceId !== evidenceId
        );
        return {
          ...current,
          status: remainingClarifications.length ? "needs_input" : "ready",
          clarifications: remainingClarifications,
          plan
        };
      });
    },
    [invalidateCoverRequest, preparation]
  );

  const acceptProposal = useCallback(() => {
    if (!pendingProposal) return;
    setPendingProposal(null);
    setPreparation(null);
    onApplyTailored(pendingProposal.coverLetterText);
    setCoverStatus("Proposal loaded. Review every claim before sending.");
    setCoverProgress({ status: "done", note: "Proposal accepted", noteTone: "ok" });
  }, [onApplyTailored, pendingProposal]);

  const editProposalDetails = useCallback(() => {
    if (!pendingProposal) return;
    setPendingProposal(null);
    setPreparation(null);
    setCoverStatus("Edit the details, then prepare a new plan.");
    setCoverProgress({ status: "idle" });
  }, [pendingProposal]);

  const discardProposal = useCallback(() => {
    if (!pendingProposal) return;
    setPendingProposal(null);
    setPreparation(null);
    setCoverStatus("Proposal discarded. The current letter was kept.");
    setCoverProgress({ status: "idle" });
  }, [pendingProposal]);

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
        controller.signal
      );
    setIsGeneratingCover(true);
    return { controller, isCurrent };
  }, [invalidateCoverRequest]);

  const finishRequest = useCallback((isCurrent: () => boolean) => {
    if (!isCurrent()) return;
    requestAbortRef.current = null;
    setIsGeneratingCover(false);
  }, []);

  const failRequest = useCallback(
    (error: unknown, isCurrent: () => boolean) => {
      if (!isCurrent()) return;
      const failure = classifyFailure(error);
      setCoverStatus(`AI cover-letter workflow unavailable: ${failure.detail}`);
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
    },
    [aiRequest.provider, aiRequest.selectedModel, onUsage]
  );

  async function handleGenerateCoverLetter() {
    setPendingProposal(null);
    if (!preflight.readyForPreparation) {
      setCoverStatus(preflight.blockingReasons[0] ?? "Complete the tailoring details first.");
      return;
    }
    if (!baseEvidence.some((item) => item.source === "resume") || jobText.trim().length < 40) {
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

    const { controller, isCurrent } = beginRequest();
    setCoverStatus("Selecting evidence for this letter…");
    setCoverProgress({ status: "running", note: "Preparing evidence plan", noteTone: "info" });
    try {
      const response = await fetch("/api/cover-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildStageRequestFields(aiRequest),
          mode: "prepare",
          sourceMode,
          sourceCoverLetterText: currentCoverLetterText.trim(),
          jobText,
          customInstructions,
          preparationValues,
          resolvedContext: preflight.resolved,
          evidenceItems,
          clarificationAnswers
        }),
        signal: controller.signal
      });
      const raw = await response.json();
      if (!isCurrent()) return;
      if (!response.ok) {
        throw new ApiError(raw.error ?? "Could not prepare the cover letter.", response.status);
      }
      const nextPreparation = preparationResponse(raw);
      if (!nextPreparation) {
        throw new ApiError("The cover-letter plan could not be read.", 502);
      }
      setPreparation(nextPreparation);
      if (nextPreparation.status === "needs_input") {
        setCoverStatus("The evidence plan needs a focused clarification before drafting.");
      } else {
        setCoverStatus("Evidence plan ready. Review what will be used before drafting.");
      }
      // Preparation is an intermediate review state, not a completed letter.
      // The rail owns that pause; the global task popover closes until drafting.
      setCoverProgress({ status: "idle" });
    } catch (error) {
      failRequest(error, isCurrent);
    } finally {
      finishRequest(isCurrent);
    }
  }

  async function generatePreparedDraft() {
    if (!preparation || preparation.status !== "ready") {
      setCoverStatus("Prepare and resolve the evidence plan before drafting.");
      return;
    }
    const selectedEvidence = selectedEvidenceForPlan(preparation.plan, evidenceItems);
    if (selectedEvidence.length < 1 || selectedEvidence.length > 3) {
      setCoverStatus("Choose one to three evidence items before drafting.");
      return;
    }
    if (
      sourceMode === "guided_draft" &&
      !selectedEvidence.some((item) => item.source === "user_answer")
    ) {
      setCoverStatus("A guided draft must use at least one of your answers.");
      return;
    }

    const { controller, isCurrent } = beginRequest();
    setCoverStatus("Drafting from the approved evidence…");
    setCoverProgress({ status: "running", note: "Drafting selected evidence", noteTone: "info" });
    try {
      const response = await fetch("/api/cover-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildStageRequestFields(aiRequest),
          mode: "draft",
          sourceMode,
          sourceCoverLetterText: currentCoverLetterText.trim(),
          jobText,
          customInstructions,
          preparationValues,
          resolvedContext: preflight.resolved,
          plan: preparation.plan,
          selectedEvidence
        }),
        signal: controller.signal
      });
      const raw = await response.json();
      if (!isCurrent()) return;
      if (!response.ok) {
        throw new ApiError(raw.error ?? "Could not draft the cover letter.", response.status);
      }
      const proposal = proposalResponse(raw);
      if (!proposal) {
        throw new ApiError("The cover-letter proposal could not be read.", 502);
      }
      const preparationAttempts = preparation.attempts ?? 0;
      const draftAttempts =
        typeof raw.attempts === "number" && Number.isFinite(raw.attempts) ? raw.attempts : 0;
      setPendingProposal({
        ...proposal,
        attempts: preparationAttempts + draftAttempts
      });
      setCoverStatus(
        `Draft ready${proposal.model ? ` from ${proposal.model}` : ""}. Review it before replacing the editor.`
      );
      setCoverProgress({ status: "done", note: "Proposal ready", noteTone: "ok" });
      onUsage?.({
        source: "ai",
        ...(proposal.provider ? { provider: proposal.provider } : {}),
        ...(proposal.model ? { model: proposal.model } : {}),
        ...(proposal.reasoningEffort ? { reasoningEffort: proposal.reasoningEffort } : {}),
        ...(preparationAttempts + draftAttempts > 0
          ? { attempts: preparationAttempts + draftAttempts }
          : {}),
        completedAt: new Date().toISOString()
      });
    } catch (error) {
      failRequest(error, isCurrent);
    } finally {
      finishRequest(isCurrent);
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
    generatePreparedDraft,
    coverProgress,
    dismissCoverProgress,
    preflight,
    preparationValues,
    updatePreparationField,
    evidenceItems,
    preparation,
    clarificationAnswers,
    updateClarificationAnswer,
    updateEvidenceDecision,
    pendingProposal,
    acceptProposal,
    editProposalDetails,
    discardProposal
  };
}
