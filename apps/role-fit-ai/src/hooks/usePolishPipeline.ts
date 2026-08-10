import { useEffect, useRef, useState } from "react";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";

import { analyzeResumeText, type PolishedResume, type ResumeProposalSuggestion } from "../resumeEngine";
import { buildStageRequestFields, type StageConfig, type StageId } from "../lib/aiRequest";
import type { StageAiUsage } from "../lib/aiUsage";
import { ApiError, classifyFailure } from "../lib/failures";
import {
  buildResumePolishScope,
  defaultResumePolishScopeModes,
  resumePolishScopeToText,
  type ResumePolishScopeMode
} from "../lib/resumePolishScope";
import {
  workflowInputFingerprint,
  workflowRequestIsCurrent,
  type PolishProgressState
} from "../lib/aiWorkflow";
import type { OutputTab } from "../sections/shared";
import type { ProviderReadiness } from "./useAvailableProviders";
import {
  flattenResumeTargets,
  sanitizeResumePolishWireResult,
  type ResumePolishWireResult
} from "../../shared/resumePolishContract.ts";

function idleProgress(): PolishProgressState {
  return { polish: { status: "idle" } };
}

type PolishContext = {
  resumeScope: ReturnType<typeof buildResumePolishScope>;
  scopedResumeText: string;
  inputFingerprint: string;
};

export type PolishRunOptions = {
  revealResumeOnSuccess?: boolean;
  onStartSettled?: (outcome: "started" | "declined") => void;
};

type UsePolishPipelineArgs = {
  editedResume: ResumeData | null;
  polishScopeModes: Record<string, ResumePolishScopeMode>;
  currentResumeText: string;
  jobDescription: string;
  requestHonestContext: string;
  customInstructionsFor: (stage: StageId) => string;
  resumePolish: StageConfig;
  ensureResumePolishProviderReady: () => Promise<ProviderReadiness>;
  setResult: (updater: PolishedResume | null | ((prev: PolishedResume | null) => PolishedResume | null)) => void;
  setActiveOutputTab: (tab: OutputTab) => void;
  setPipelineAiUsage: (updater: (prev: Record<string, StageAiUsage>) => Record<string, StageAiUsage>) => void;
  setPolishStatus: (value: string) => void;
  resetExportStatuses: () => void;
  setExportStatus: (value: string) => void;
  confirmDuplicateBeforePolish: () => Promise<boolean>;
};

async function readProposalResponse(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    throw new ApiError("The resume proposal returned an unparseable response", 502);
  }
}

function proposalSuggestions(
  data: ResumePolishWireResult,
  resumeScope: ReturnType<typeof buildResumePolishScope>
): ResumeProposalSuggestion[] {
  const targets = new Map(flattenResumeTargets(resumeScope).map((target) => [target.targetId, target]));
  return data.changes.flatMap((change) => {
    const target = targets.get(change.targetId);
    if (!target) return [];
    return [{
      id: change.targetId,
      target: target.target,
      sectionHeading: target.section,
      currentText: target.currentText,
      proposedText: change.replacement,
      reason: change.reason ?? ""
    }];
  });
}

export function usePolishPipeline({
  editedResume,
  polishScopeModes,
  currentResumeText,
  jobDescription,
  requestHonestContext,
  customInstructionsFor,
  resumePolish,
  ensureResumePolishProviderReady,
  setResult,
  setActiveOutputTab,
  setPipelineAiUsage,
  setPolishStatus,
  resetExportStatuses,
  setExportStatus,
  confirmDuplicateBeforePolish
}: UsePolishPipelineArgs) {
  const [isPolishing, setIsPolishing] = useState(false);
  const [isPolishStarting, setIsPolishStarting] = useState(false);
  const [polishProgress, setPolishProgress] = useState<PolishProgressState>(idleProgress);
  const [polishProgressVisible, setPolishProgressVisible] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const runLockRef = useRef(false);
  const startSettlementRef = useRef<PolishRunOptions["onStartSettled"]>(undefined);
  const inputFingerprint = workflowInputFingerprint({
    editedResume,
    polishScopeModes,
    currentResumeText,
    jobDescription,
    requestHonestContext,
    customInstructions: customInstructionsFor("resume-polish"),
    resumePolish: buildStageRequestFields(resumePolish)
  });
  const inputFingerprintRef = useRef(inputFingerprint);
  inputFingerprintRef.current = inputFingerprint;
  const previousJobDescriptionRef = useRef(jobDescription);

  function settleStart(outcome: "started" | "declined"): void {
    const callback = startSettlementRef.current;
    startSettlementRef.current = undefined;
    callback?.(outcome);
  }

  function requestIsCurrent(generation: number, context: PolishContext, signal?: AbortSignal): boolean {
    return workflowRequestIsCurrent(
      generation,
      generationRef.current,
      context.inputFingerprint,
      inputFingerprintRef.current,
      signal
    );
  }

  useEffect(() => {
    const jobChanged = previousJobDescriptionRef.current !== jobDescription;
    previousJobDescriptionRef.current = jobDescription;
    if (!runLockRef.current && !abortRef.current) {
      if (jobChanged) {
        setPolishProgress(idleProgress());
        setPolishProgressVisible(false);
      }
      return;
    }
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    runLockRef.current = false;
    setIsPolishStarting(false);
    settleStart("declined");
    setIsPolishing(false);
    setPolishProgress((current) => ({
      ...current,
      polish: current.polish.status === "running"
        ? { status: "stopped", errorHeadline: "Inputs changed", error: "Polish was cancelled before it could replace the current proposal." }
        : current.polish
    }));
    setPolishProgressVisible(true);
    setPolishStatus("Resume, job, or AI settings changed. Polish again for the current inputs.");
  }, [inputFingerprint, jobDescription, setPolishStatus]);

  useEffect(() => () => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    runLockRef.current = false;
    startSettlementRef.current = undefined;
  }, []);

  function buildContext(): PolishContext | null {
    if (!editedResume) {
      setPolishStatus("Load a resume before polishing.");
      return null;
    }
    const modes = Object.keys(polishScopeModes).length
      ? polishScopeModes
      : defaultResumePolishScopeModes(editedResume);
    const polishIds = Object.keys(modes).filter((id) => modes[id] === "polish");
    const contextIds = Object.keys(modes).filter((id) => modes[id] === "include");
    const resumeScope = buildResumePolishScope(editedResume, polishIds, contextIds);
    const scopedResumeText = resumePolishScopeToText(resumeScope);
    if (!flattenResumeTargets(resumeScope).length || resumePolishScopeToText(resumeScope, true).trim().length < 40) {
      setPolishStatus("Set at least one editable resume section to Polish.");
      return null;
    }
    return { resumeScope, scopedResumeText, inputFingerprint: inputFingerprintRef.current };
  }

  async function runProposal(
    context: PolishContext,
    generation: number,
    signal: AbortSignal,
    revealResumeOnSuccess: boolean
  ): Promise<boolean> {
    if (!requestIsCurrent(generation, context, signal)) return false;
    setPolishProgress({ polish: { status: "running" } });
    try {
      const response = await fetch("/api/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildStageRequestFields(resumePolish),
          mode: "resume-proposal",
          resumeScope: context.resumeScope,
          jobText: jobDescription,
          honestContext: requestHonestContext,
          customInstructions: customInstructionsFor("resume-polish")
        }),
        signal
      });
      const raw = await readProposalResponse(response);
      if (!requestIsCurrent(generation, context, signal)) return false;
      if (!response.ok) throw new ApiError((raw.error as string) ?? "Resume Polish failed.", response.status);
      const data = sanitizeResumePolishWireResult(raw);
      if (!data) {
        throw new ApiError("Resume Polish returned an invalid outcome", 422);
      }
      const suggestions = proposalSuggestions(data, context.resumeScope);
      if (data.status === "PROPOSAL" && !suggestions.length) {
        throw new ApiError("Resume Polish returned no usable proposal edits", 422);
      }
      const analysis = analyzeResumeText(currentResumeText || context.scopedResumeText, jobDescription);
      setResult({
        ...analysis,
        proposalBaselineText: currentResumeText || context.scopedResumeText,
        source: "ai",
        polishOutcome: data.status,
        changeSummary: Array.isArray(data.summary) ? data.summary : [],
        omittedTargetCount: data.omittedTargetCount,
        suggestedChanges: suggestions,
        withheld: data.withheld
      });
      if (revealResumeOnSuccess) setActiveOutputTab("resume");
      const note = data.status === "PROPOSAL"
        ? `${suggestions.length} edit${suggestions.length === 1 ? "" : "s"} ready`
        : data.status === "NO_CHANGES"
          ? "No safe material changes suggested"
          : "Suggestions withheld; resume unchanged";
      setPolishProgress(data.status === "WITHHELD"
        ? {
            polish: {
              status: "failed",
              errorHeadline: "Suggestions withheld",
              error: "The generated edits could not be verified. Your resume is unchanged."
            }
          }
        : {
            polish: { status: "done", note, noteTone: "ok" }
          });
      setPolishStatus(note);
      setPipelineAiUsage((current) => ({
        ...current,
        "resume-polish": {
          source: "ai",
          ...(typeof raw.provider === "string" && raw.provider ? { provider: raw.provider } : {}),
          ...(typeof raw.model === "string" && raw.model ? { model: raw.model } : {}),
          ...(typeof raw.reasoningEffort === "string" && raw.reasoningEffort ? { reasoningEffort: raw.reasoningEffort } : {}),
          ...(typeof raw.attempts === "number" ? { attempts: raw.attempts } : {}),
          completedAt: new Date().toISOString()
        }
      }));
      return true;
    } catch (error) {
      if (signal.aborted) return false;
      if (!requestIsCurrent(generation, context)) return false;
      const failure = classifyFailure(error);
      setPolishProgress({
        polish: { status: "failed", errorHeadline: failure.headline, error: failure.detail }
      });
      setPolishStatus(`${failure.headline}: ${failure.detail}`);
      setPipelineAiUsage((current) => ({
        ...current,
        "resume-polish": {
          source: "none",
          requestedProvider: resumePolish.provider,
          requestedModel: resumePolish.selectedModel,
          completedAt: new Date().toISOString()
        }
      }));
      return false;
    }
  }

  async function continueRun(options: PolishRunOptions): Promise<void> {
    let context: PolishContext | null = null;
    try {
      const provider = await ensureResumePolishProviderReady();
      if (!runLockRef.current) return;
      if (!provider.ready) {
        runLockRef.current = false;
        setIsPolishStarting(false);
        settleStart("declined");
        setPolishStatus(provider.message);
        setPolishProgress({
          polish: { status: "failed", errorHeadline: "Provider unavailable", error: provider.message }
        });
        setPolishProgressVisible(true);
        return;
      }
      if (!(await confirmDuplicateBeforePolish())) {
        runLockRef.current = false;
        setIsPolishStarting(false);
        settleStart("declined");
        return;
      }
      if (!runLockRef.current) return;
      context = buildContext();
      if (!context) {
        runLockRef.current = false;
        setIsPolishStarting(false);
        settleStart("declined");
        return;
      }
    } catch (error) {
      if (!runLockRef.current) return;
      runLockRef.current = false;
      setIsPolishStarting(false);
      settleStart("declined");
      const failure = classifyFailure(error);
      setPolishProgress({
        polish: { status: "failed", errorHeadline: failure.headline, error: failure.detail }
      });
      setPolishProgressVisible(true);
      setPolishStatus(`${failure.headline}: ${failure.detail}`);
      return;
    }

    setIsPolishing(true);
    setIsPolishStarting(false);
    settleStart("started");
    setPolishProgressVisible(true);
    resetExportStatuses();
    setExportStatus("");
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = ++generationRef.current;
    try {
      await runProposal(context, generation, controller.signal, options.revealResumeOnSuccess !== false);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (generation === generationRef.current) {
        runLockRef.current = false;
        setIsPolishing(false);
      }
    }
  }

  function startRun(options: PolishRunOptions = {}): boolean {
    if (runLockRef.current || isPolishing) return false;
    runLockRef.current = true;
    if (!buildContext()) {
      runLockRef.current = false;
      return false;
    }
    startSettlementRef.current = options.onStartSettled;
    setIsPolishStarting(true);
    void continueRun(options);
    return true;
  }

  function stopPolish(): void {
    if (!abortRef.current) return;
    generationRef.current += 1;
    abortRef.current.abort();
    abortRef.current = null;
    runLockRef.current = false;
    setIsPolishing(false);
    setPolishProgress((current) => ({
      ...current,
      polish: current.polish.status === "running"
        ? { status: "stopped", errorHeadline: "Stopped", error: "Polish stopped. Your resume is unchanged." }
        : current.polish
    }));
    setPolishStatus("Polish stopped. Your resume is unchanged.");
  }

  return {
    isPolishStarting,
    isPolishing,
    polishProgress,
    polishProgressVisible,
    setPolishProgressVisible,
    handlePolish: startRun,
    retryStage: () => startRun(),
    stopPolish
  };
}
