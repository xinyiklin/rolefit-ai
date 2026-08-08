/**
 * useDocumentCheck — the current-document check that closes both Polish flows.
 *
 * It was a separately named, manually operated "Final Check" section in the
 * Resume rail, which made an internal phase look like another tool the user had
 * to understand and drive. It is now the last phase of Polish for both
 * documents, and this hook owns when it runs.
 *
 * Why it cannot simply ride along in the Polish request the way the cover
 * letter's validation does: a resume proposal is a set of individual edits, so
 * the resulting resume does not exist until the user has accepted, edited, or
 * discarded each one. Checking at Polish time would check a hypothetical
 * "accept everything" resume and be wrong the moment the user accepts only
 * some. So the check runs ONCE when the last decision settles — not per
 * accepted edit, which would spend a request per click and leave stale results
 * behind.
 *
 * A cover letter needs no request at all after Polish: the exact letter it
 * accepted is the one the server already validated and repaired, so
 * `adoptValidatedReceipt` records that as the Ready outcome. The request path
 * exists for the letters that have no such receipt — manually authored,
 * imported, or edited after acceptance.
 *
 * Staleness has two meanings and they are not interchangeable: editing the
 * document invites a re-check, while changing the job, evidence, or guidance
 * invites a re-polish. They are tracked as separate fingerprints.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  sanitizeFinalCheckWireResult,
  type FinalCheckResult
} from "../../shared/finalCheckContract.ts";
import { buildStageRequestFields, type StageConfig } from "../lib/aiRequest";
import type { StageAiUsage } from "../lib/aiUsage";
import { contentFingerprint } from "../lib/contentFingerprint.ts";
import { ApiError, classifyFailure } from "../lib/failures";
import {
  workflowInputFingerprint,
  workflowRequestIsCurrent,
  type AiStageState
} from "../lib/aiWorkflow";
import type { ProviderReadiness } from "./useAvailableProviders";

export type DocumentCheckKind = "resume" | "cover-letter";

// Where the Ready/Review/Needs evidence outcome came from. A letter accepted
// from a validated proposal is genuinely checked, but by Polish rather than by
// a document check, and the rail must be able to say which.
export type DocumentCheckSource = "document-check" | "polish-validation";

const NOUNS: Record<DocumentCheckKind, string> = {
  resume: "resume",
  "cover-letter": "cover letter"
};

type UseDocumentCheckArgs = {
  documentKind: DocumentCheckKind;
  documentText: string;
  evidenceText: string;
  jobDescription: string;
  customInstructions: string;
  // The automatic phase is skippable. It is one extra provider request per
  // polish, which is a real cost on metered providers, so it stays user-owned
  // even though it is no longer a user-operated workflow section.
  enabled: boolean;
  stageConfig: StageConfig;
  ensureProviderReady: () => Promise<ProviderReadiness>;
  setPipelineAiUsage: (updater: (current: Record<string, StageAiUsage>) => Record<string, StageAiUsage>) => void;
  usageKey: string;
};

async function readCheckResponse(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    throw new ApiError("The check returned an unparseable response", 502);
  }
}

export function useDocumentCheck({
  documentKind,
  documentText,
  evidenceText,
  jobDescription,
  customInstructions,
  enabled,
  stageConfig,
  ensureProviderReady,
  setPipelineAiUsage,
  usageKey
}: UseDocumentCheckArgs) {
  const noun = NOUNS[documentKind];
  const [check, setCheck] = useState<FinalCheckResult | null>(null);
  const [checkSource, setCheckSource] = useState<DocumentCheckSource>("document-check");
  const [checkedDocumentFingerprint, setCheckedDocumentFingerprint] = useState("");
  const [checkedInputsFingerprint, setCheckedInputsFingerprint] = useState("");
  const [progress, setProgress] = useState<AiStageState>({ status: "idle" });
  const [status, setStatus] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const runLockRef = useRef(false);
  // Which settled proposal already triggered the automatic phase. One key per
  // proposal, so resolving the last edit runs the check exactly once.
  const autoRunKeyRef = useRef<string | null>(null);

  const documentFingerprint = contentFingerprint(documentText);
  // Evidence, job, and guidance move together: any of them changing means the
  // finished result was judged against inputs that no longer apply.
  const inputsFingerprint = workflowInputFingerprint({
    evidenceText,
    jobDescription,
    customInstructions
  });
  const requestFingerprint = workflowInputFingerprint({
    documentFingerprint,
    inputsFingerprint,
    aiRequest: buildStageRequestFields(stageConfig)
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
    setProgress({
      status: "stopped",
      errorHeadline: "Inputs changed",
      error: `Check the current ${noun} again for the current job and settings.`
    });
    setStatus("The check stopped because its inputs changed.");
  }, [noun, requestFingerprint]);

  useEffect(() => () => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    runLockRef.current = false;
  }, []);

  const runCheck = useCallback(async (): Promise<void> => {
    if (runLockRef.current || isChecking) return;
    if (documentText.trim().length < 80) {
      setStatus(`Add your ${noun} before checking it.`);
      return;
    }
    if (jobDescription.trim().length < 40) {
      setStatus(`Prepare the job before checking the ${noun}.`);
      return;
    }

    runLockRef.current = true;
    const provider = await ensureProviderReady();
    if (!runLockRef.current) return;
    if (!provider.ready) {
      runLockRef.current = false;
      setProgress({ status: "failed", errorHeadline: "Provider unavailable", error: provider.message });
      setStatus(provider.message);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const generation = ++generationRef.current;
    const submittedRequestFingerprint = requestFingerprintRef.current;
    const submittedDocumentFingerprint = documentFingerprint;
    const submittedInputsFingerprint = inputsFingerprint;
    const requestIsCurrent = () => workflowRequestIsCurrent(
      generation,
      generationRef.current,
      submittedRequestFingerprint,
      requestFingerprintRef.current,
      controller.signal
    );
    setIsChecking(true);
    setProgress({ status: "running" });
    setStatus(`Reviewing the current ${noun} for evidence, coverage, and clarity…`);
    try {
      const response = await fetch("/api/final-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildStageRequestFields(stageConfig),
          documentKind,
          documentText,
          evidenceText,
          jobText: jobDescription,
          customInstructions
        }),
        signal: controller.signal
      });
      const raw = await readCheckResponse(response);
      if (!requestIsCurrent()) return;
      if (!response.ok) throw new ApiError((raw.error as string) ?? "The check failed.", response.status);
      const checked = sanitizeFinalCheckWireResult(raw);
      if (!checked) throw new ApiError("The check returned an invalid outcome", 422);
      setCheck(checked);
      setCheckSource("document-check");
      setCheckedDocumentFingerprint(submittedDocumentFingerprint);
      setCheckedInputsFingerprint(submittedInputsFingerprint);
      const note = checked.status === "READY"
        ? "Ready"
        : checked.status === "NEEDS_EVIDENCE"
          ? "Needs evidence"
          : `${checked.issues.length} item${checked.issues.length === 1 ? "" : "s"} to review`;
      setProgress({ status: "done", note, noteTone: checked.status === "READY" ? "ok" : "warn" });
      setStatus(note);
      setPipelineAiUsage((current) => ({
        ...current,
        [usageKey]: {
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
      setProgress({ status: "failed", errorHeadline: failure.headline, error: failure.detail });
      setStatus(`${failure.headline}: ${failure.detail}`);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (generation === generationRef.current) {
        runLockRef.current = false;
        setIsChecking(false);
      }
    }
  }, [
    documentFingerprint,
    documentKind,
    documentText,
    customInstructions,
    ensureProviderReady,
    evidenceText,
    inputsFingerprint,
    isChecking,
    jobDescription,
    noun,
    setPipelineAiUsage,
    stageConfig,
    usageKey
  ]);

  // Run the automatic phase once for a settled proposal. The key is the
  // proposal's identity, so re-deciding the same proposal never re-spends a
  // request while a fresh proposal always earns its own check.
  const requestAutoCheck = useCallback((key: string): void => {
    if (!enabled || !key || autoRunKeyRef.current === key) return;
    autoRunKeyRef.current = key;
    void runCheck();
  }, [enabled, runCheck]);

  // A cover letter accepted from a validated proposal is already checked: that
  // exact text is what the server validated and, where needed, repaired. Record
  // it rather than paying for a second opinion on the same bytes.
  const adoptValidatedReceipt = useCallback((acceptedText: string, summary: string): void => {
    autoRunKeyRef.current = null;
    setCheck({ status: "READY", summary, issues: [] });
    setCheckSource("polish-validation");
    setCheckedDocumentFingerprint(contentFingerprint(acceptedText));
    setCheckedInputsFingerprint(inputsFingerprint);
    setProgress({ status: "done", note: "Ready", noteTone: "ok" });
    setStatus(summary);
  }, [inputsFingerprint]);

  const clearCheck = useCallback((): void => {
    autoRunKeyRef.current = null;
    setCheck(null);
    setCheckedDocumentFingerprint("");
    setCheckedInputsFingerprint("");
    setProgress({ status: "idle" });
    setStatus("");
  }, []);

  function stopCheck(): void {
    if (!abortRef.current) return;
    generationRef.current += 1;
    abortRef.current.abort();
    abortRef.current = null;
    runLockRef.current = false;
    setIsChecking(false);
    setProgress({
      status: "stopped",
      errorHeadline: "Stopped",
      error: `The check stopped. Your ${noun} is unchanged.`
    });
    setStatus(`The check stopped. Your ${noun} is unchanged.`);
  }

  return {
    check,
    checkSource,
    // Two distinct reasons a settled result no longer describes what is on
    // screen. The user re-checks after one and re-polishes after the other.
    checkDocumentChanged: Boolean(check && checkedDocumentFingerprint !== documentFingerprint),
    checkInputsChanged: Boolean(check && checkedInputsFingerprint !== inputsFingerprint),
    progress,
    status,
    isChecking,
    runCheck,
    requestAutoCheck,
    adoptValidatedReceipt,
    clearCheck,
    stopCheck
  };
}
