import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildAuditRequestFields } from "../lib/aiRequest";
import { ApiError, classifyFailure } from "../lib/failures";
import {
  initialFitAuditFingerprint,
  parseInitialFitAuditResponse,
  type InitialFitAudit,
  type InitialFitAuditInput
} from "../lib/initialFitAudit";
import type { ProviderReadiness } from "./useAvailableProviders";

export type InitialFitAuditState =
  | { status: "idle" }
  | { status: "running"; fingerprint: string; previous?: InitialFitAudit }
  | { status: "ready"; result: InitialFitAudit }
  | { status: "stale"; result: InitialFitAudit; reason: string }
  | { status: "failed"; fingerprint: string; errorHeadline: string; error: string }
  | { status: "stopped"; fingerprint: string; error: string; previous?: InitialFitAudit };

export type InitialFitAuditRunOutcome =
  | { status: "completed"; result: InitialFitAudit }
  | { status: "failed"; reason: string }
  | { status: "stopped" }
  | { status: "stale" };

type UseInitialFitAuditArgs = {
  input: InitialFitAuditInput | null;
  ensureReviewProviderReady: () => Promise<ProviderReadiness>;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function useInitialFitAudit({ input, ensureReviewProviderReady }: UseInitialFitAuditArgs) {
  const fingerprint = useMemo(() => input ? initialFitAuditFingerprint(input) : "", [input]);
  const inputRef = useRef(input);
  const fingerprintRef = useRef(fingerprint);
  inputRef.current = input;
  fingerprintRef.current = fingerprint;

  const [state, setState] = useState<InitialFitAuditState>({ status: "idle" });
  const stateRef = useRef(state);
  stateRef.current = state;
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const runLockRef = useRef(false);
  const activeFingerprintRef = useRef("");
  const completedInitialAudits = useRef(new Map<string, InitialFitAudit>());

  useEffect(() => {
    if (activeFingerprintRef.current && activeFingerprintRef.current !== fingerprint) {
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      runLockRef.current = false;
      activeFingerprintRef.current = "";
    }
    setState((current) => {
      if (current.status === "ready" && current.result.fingerprint !== fingerprint) {
        return { status: "stale", result: current.result, reason: "Resume or prepared job changed after Initial Fit." };
      }
      if (current.status === "stale" && current.result.fingerprint === fingerprint) {
        return { status: "ready", result: current.result };
      }
      if (current.status === "running" && current.fingerprint !== fingerprint) {
        return current.previous
          ? { status: "stale", result: current.previous, reason: "Inputs changed while Initial Fit was running." }
          : { status: "stopped", fingerprint: current.fingerprint, error: "Inputs changed while Initial Fit was running." };
      }
      if ((current.status === "failed" || current.status === "stopped") && current.fingerprint !== fingerprint) {
        return { status: "idle" };
      }
      return current;
    });
  }, [fingerprint]);

  useEffect(() => () => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    runLockRef.current = false;
  }, []);

  const run = useCallback(async ({ force = false }: { force?: boolean } = {}): Promise<InitialFitAuditRunOutcome> => {
    const snapshot = inputRef.current;
    const expectedFingerprint = fingerprintRef.current;
    if (!snapshot || !expectedFingerprint) {
      const reason = "Prepare a job and select a resume before running Initial Fit.";
      setState({ status: "failed", fingerprint: "", errorHeadline: "Initial Fit unavailable", error: reason });
      return { status: "failed", reason };
    }
    if (runLockRef.current) return { status: "stopped" };
    const completed = completedInitialAudits.current.get(expectedFingerprint);
    if (!force && completed) {
      if (stateRef.current.status !== "ready" || stateRef.current.result.fingerprint !== expectedFingerprint) {
        setState({ status: "ready", result: completed });
      }
      return { status: "completed", result: completed };
    }

    const previous = stateRef.current.status === "ready" || stateRef.current.status === "stale"
      ? stateRef.current.result
      : undefined;
    runLockRef.current = true;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const controller = new AbortController();
    abortRef.current = controller;
    activeFingerprintRef.current = expectedFingerprint;
    setState({ status: "running", fingerprint: expectedFingerprint, ...(previous ? { previous } : {}) });

    try {
      const readiness = await ensureReviewProviderReady();
      if (!readiness.ready) {
        const reason = readiness.message || "Reconnect the Recruiter Audit provider in RoleFit Companion, then retry Initial Fit.";
        if (generation === generationRef.current) {
          setState({ status: "failed", fingerprint: expectedFingerprint, errorHeadline: "Check AI settings", error: reason });
        }
        return { status: "failed", reason };
      }
      const response = await fetch("/api/fit-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          preparationId: snapshot.preparationId,
          jobText: snapshot.jobText,
          resumeFileName: snapshot.resumeFileName,
          resumeDocumentVersion: snapshot.resumeDocumentVersion,
          resumeText: snapshot.resumeText,
          honestContext: snapshot.honestContext,
          customInstructions: snapshot.reviewInstructions,
          ...buildAuditRequestFields(snapshot.review)
        })
      });
      const data = await readJson(response);
      if (!response.ok) throw new ApiError(typeof data.error === "string" ? data.error : "Initial Fit audit failed.", response.status);
      const result = parseInitialFitAuditResponse(data, snapshot);
      if (!result) throw new ApiError("Initial Fit returned an invalid result. Retry, or switch providers.", 502);
      if (
        generation !== generationRef.current ||
        controller.signal.aborted ||
        fingerprintRef.current !== expectedFingerprint
      ) return { status: "stale" };

      completedInitialAudits.current.set(expectedFingerprint, result);
      setState({ status: "ready", result });
      return { status: "completed", result };
    } catch (error) {
      if (controller.signal.aborted || generation !== generationRef.current) return { status: "stopped" };
      const failure = classifyFailure(error);
      setState({
        status: "failed",
        fingerprint: expectedFingerprint,
        errorHeadline: failure.headline,
        error: failure.detail
      });
      return { status: "failed", reason: failure.detail };
    } finally {
      if (generation === generationRef.current) {
        runLockRef.current = false;
        abortRef.current = null;
        activeFingerprintRef.current = "";
      }
    }
  }, [ensureReviewProviderReady]);

  const stop = useCallback(() => {
    if (!runLockRef.current) return;
    const current = stateRef.current;
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    runLockRef.current = false;
    activeFingerprintRef.current = "";
    const previous = current.status === "running" ? current.previous : undefined;
    setState({
      status: "stopped",
      fingerprint: current.status === "running" ? current.fingerprint : fingerprintRef.current,
      error: "Initial Fit was stopped before it could update this preparation.",
      ...(previous ? { previous } : {})
    });
  }, []);

  const reset = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    runLockRef.current = false;
    activeFingerprintRef.current = "";
    completedInitialAudits.current.clear();
    setState({ status: "idle" });
  }, []);

  const retry = useCallback(() => run({ force: true }), [run]);

  return {
    fingerprint,
    state,
    result: state.status === "ready" || state.status === "stale" ? state.result : null,
    isRunning: state.status === "running",
    run,
    retry,
    stop,
    reset
  };
}
