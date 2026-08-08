import { useEffect, useRef, useState } from "react";

import {
  sanitizeFinalCheckWireResult,
  type FinalCheckResult
} from "../../shared/finalCheckContract.ts";
import { buildStageRequestFields, type StageConfig } from "../lib/aiRequest";
import type { StageAiUsage } from "../lib/aiUsage";
import { ApiError, classifyFailure } from "../lib/failures";
import {
  workflowInputFingerprint,
  workflowRequestIsCurrent,
  type AiStageState
} from "../lib/aiWorkflow";
import type { ProviderReadiness } from "./useAvailableProviders";

type UseFinalCheckArgs = {
  currentResumeText: string;
  evidenceText: string;
  jobDescription: string;
  customInstructions: string;
  finalCheckConfig: StageConfig;
  ensureFinalCheckProviderReady: () => Promise<ProviderReadiness>;
  setPipelineAiUsage: (updater: (current: Record<string, StageAiUsage>) => Record<string, StageAiUsage>) => void;
};

async function readFinalCheckResponse(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    throw new ApiError("Final Check returned an unparseable response", 502);
  }
}

export function useFinalCheck({
  currentResumeText,
  evidenceText,
  jobDescription,
  customInstructions,
  finalCheckConfig,
  ensureFinalCheckProviderReady,
  setPipelineAiUsage
}: UseFinalCheckArgs) {
  const [finalCheck, setFinalCheck] = useState<FinalCheckResult | null>(null);
  const [resultFingerprint, setResultFingerprint] = useState("");
  const [finalCheckProgress, setFinalCheckProgress] = useState<AiStageState>({ status: "idle" });
  const [finalCheckStatus, setFinalCheckStatus] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const runLockRef = useRef(false);

  const contentFingerprint = workflowInputFingerprint({
    currentResumeText,
    evidenceText,
    jobDescription,
    customInstructions
  });
  const requestFingerprint = workflowInputFingerprint({
    contentFingerprint,
    aiRequest: buildStageRequestFields(finalCheckConfig)
  });
  const requestFingerprintRef = useRef(requestFingerprint);
  requestFingerprintRef.current = requestFingerprint;

  useEffect(() => {
    const active = abortRef.current;
    if (!active && !runLockRef.current) return;
    generationRef.current += 1;
    active?.abort();
    abortRef.current = null;
    runLockRef.current = false;
    setIsChecking(false);
    setFinalCheckProgress({
      status: "stopped",
      errorHeadline: "Inputs changed",
      error: "Run Final Check again for the current resume, job, and settings."
    });
    setFinalCheckStatus("Final Check stopped because its inputs changed.");
  }, [requestFingerprint]);

  useEffect(() => () => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    runLockRef.current = false;
  }, []);

  async function runFinalCheck(): Promise<void> {
    if (runLockRef.current || isChecking) return;
    if (currentResumeText.trim().length < 80) {
      setFinalCheckStatus("Add your resume before running Final Check.");
      return;
    }
    if (jobDescription.trim().length < 40) {
      setFinalCheckStatus("Prepare the job before running Final Check.");
      return;
    }

    runLockRef.current = true;
    const provider = await ensureFinalCheckProviderReady();
    if (!runLockRef.current) return;
    if (!provider.ready) {
      runLockRef.current = false;
      setFinalCheckProgress({
        status: "failed",
        errorHeadline: "Provider unavailable",
        error: provider.message
      });
      setFinalCheckStatus(provider.message);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const generation = ++generationRef.current;
    const submittedRequestFingerprint = requestFingerprintRef.current;
    const submittedContentFingerprint = contentFingerprint;
    const requestIsCurrent = () => workflowRequestIsCurrent(
      generation,
      generationRef.current,
      submittedRequestFingerprint,
      requestFingerprintRef.current,
      controller.signal
    );
    setIsChecking(true);
    setFinalCheckProgress({ status: "running" });
    setFinalCheckStatus("Checking the actual current resume…");
    try {
      const response = await fetch("/api/final-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildStageRequestFields(finalCheckConfig),
          resumeText: currentResumeText,
          evidenceText,
          jobText: jobDescription,
          customInstructions
        }),
        signal: controller.signal
      });
      const raw = await readFinalCheckResponse(response);
      if (!requestIsCurrent()) return;
      if (!response.ok) throw new ApiError((raw.error as string) ?? "Final Check failed.", response.status);
      const checked = sanitizeFinalCheckWireResult(raw);
      if (!checked) throw new ApiError("Final Check returned an invalid outcome", 422);
      setFinalCheck(checked);
      setResultFingerprint(submittedContentFingerprint);
      const note = checked.status === "READY"
        ? "Ready"
        : checked.status === "NEEDS_EVIDENCE"
          ? "Evidence needed"
          : `${checked.issues.length} item${checked.issues.length === 1 ? "" : "s"} to review`;
      setFinalCheckProgress({ status: "done", note, noteTone: checked.status === "READY" ? "ok" : "warn" });
      setFinalCheckStatus(note);
      setPipelineAiUsage((current) => ({
        ...current,
        "final-check": {
          source: "ai",
          ...(typeof raw.provider === "string" && raw.provider ? { provider: raw.provider } : {}),
          ...(typeof raw.model === "string" && raw.model ? { model: raw.model } : {}),
          ...(typeof raw.reasoningEffort === "string" && raw.reasoningEffort ? { reasoningEffort: raw.reasoningEffort } : {}),
          ...(typeof raw.attempts === "number" ? { attempts: raw.attempts } : {}),
          completedAt: new Date().toISOString()
        }
      }));
    } catch (error) {
      if (controller.signal.aborted || !requestIsCurrent()) return;
      const failure = classifyFailure(error);
      setFinalCheckProgress({ status: "failed", errorHeadline: failure.headline, error: failure.detail });
      setFinalCheckStatus(`${failure.headline}: ${failure.detail}`);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (generation === generationRef.current) {
        runLockRef.current = false;
        setIsChecking(false);
      }
    }
  }

  function stopFinalCheck(): void {
    if (!abortRef.current) return;
    generationRef.current += 1;
    abortRef.current.abort();
    abortRef.current = null;
    runLockRef.current = false;
    setIsChecking(false);
    setFinalCheckProgress({
      status: "stopped",
      errorHeadline: "Stopped",
      error: "Final Check stopped. The resume and Polish proposal are unchanged."
    });
    setFinalCheckStatus("Final Check stopped. The resume and Polish proposal are unchanged.");
  }

  return {
    finalCheck,
    finalCheckStale: Boolean(finalCheck && resultFingerprint !== contentFingerprint),
    finalCheckProgress,
    finalCheckStatus,
    isChecking,
    runFinalCheck,
    retryFinalCheck: runFinalCheck,
    stopFinalCheck
  };
}
