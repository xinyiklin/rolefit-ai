/**
 * useJobIntake — the job-analysis/import flows, extracted from App.tsx:
 * It owns link analysis, pasted-posting analysis, the browser-extension inbox
 * import, each entry point's Retry, and the manual-edit handler. Every Job
 * analysis provenance write (`pipelineAiUsage["job-analysis"]` and jobRawText)
 * lives in this one module.
 *
 * State ownership: jobAnalysisProgress/jobAnalysisProgressVisible/jobAnalysisRetrySource/
 * isExtractingLink are OWNED here (not passed in) because every mutator of
 * them is one of these handlers — App only READS them for render (the
 * shared AI workflow, Prepare's source controls, the progress-dock visibility
 * check, and the _myPhase presence memo), so returning them keeps the
 * interface small without leaking control back to App.
 *
 * jobUrl/jobDescription/importedJob/result/pipelineAiUsage/jobRawText/
 * polishStatus stay in App (it seeds/derives from them well
 * beyond this flow — jobTracking, autosave, presence, canPolish, etc.), so
 * their setters arrive via the args object.
 */
import { useEffect, useRef, useState } from "react";
import type { ExtractedJobTracking } from "../lib/jobExtract";
import { extractJobPosting } from "../lib/jobExtract";
import {
  analyzeFitAssessment,
  analyzeJobPosting,
  localJobAnalysisResult,
  type FitAssessmentExecutionUsage,
  type FitAssessmentRequest,
  type JobAnalysisResult
} from "../lib/aiJobAnalysis";
import { aiRequestFieldsMatch, type AiRequestFields } from "../lib/aiRequest.ts";
import { ApiError, classifyFailure } from "../lib/failures";
import { useExtensionInbox, type ExtensionImport } from "./useExtensionInbox";
import {
  workflowInputFingerprint,
  workflowRequestIsCurrent,
  type AiStageState as StageState
} from "../lib/aiWorkflow";
import type { StageAiUsage } from "../lib/aiUsage";
import type { PolishedResume } from "../resumeEngine";
import type { ProviderReadiness } from "./useAvailableProviders";
import {
  buildPreparedJobBrief,
  reconcilePreparedJobManualReviewFields,
  type PreparedJobBrief
} from "../lib/preparedJobBrief";
import {
  FIT_ASSESSMENT_PROMPT_VERSION,
  type FitAssessmentResult,
  type FitAssessmentSnapshot,
  type FitAssessmentState
} from "../../shared/fitAssessmentContract.ts";
import type { PreparedResumeSelection } from "../lib/preparedResume.ts";
import type { PreparedResumeResolutionControls } from "./usePreparedResume.ts";
import {
  createFitAssessmentProvenance,
  dispatchFitAssessment,
  fitAssessmentCanRun,
  fitAssessmentProvenanceChanges,
  restoredFitAssessmentState,
  type PreparedFitAssessmentJob
} from "../lib/fitAssessmentLifecycle.ts";

export type ImportedJobSnapshot = {
  url: string;
  // Immutable source identity for this prepared snapshot. It lets App
  // distinguish "Prepare again" from unrelated fresh intake without comparing
  // the analyzed projection.
  sourceText: string;
  tailoringText: string;
  tracking: ExtractedJobTracking;
  brief: PreparedJobBrief;
  manualReviewFields: string[];
};

function importedJobSnapshot(
  url: string,
  tailoringText: string,
  extracted: ReturnType<typeof extractJobPosting>,
  sourceText: string
): ImportedJobSnapshot {
  const brief = buildPreparedJobBrief(extracted.tailoringText, sourceText);
  return {
    url,
    sourceText: sourceText.trim(),
    tailoringText: tailoringText.trim(),
    tracking: extracted.tracking,
    brief,
    manualReviewFields: reconcilePreparedJobManualReviewFields(
      extracted.tracking,
      brief,
      extracted.manualReviewFields
    )
  };
}

function presentTrackingFields(tracking: ExtractedJobTracking) {
  const fields = [
    tracking.role || tracking.title ? "role" : "",
    tracking.company ? "company" : "",
    tracking.location ? "location" : "",
    tracking.jobType ? "job type" : "",
    tracking.salaryMin != null || tracking.salaryMax != null ? "compensation" : "",
    tracking.roleDescription ? "role context" : ""
  ].filter(Boolean);
  if (!fields.length) return "no tracking fields";
  if (fields.length === 1) return fields[0];
  return `${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]}`;
}

function compactManualReviewFields(fields: string[]) {
  const unique = [...new Set(fields)].filter((field) => field !== "job description");
  if (!unique.length) return "";
  if (unique.length === 1) return unique[0];
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

type UseJobIntakeArgs = {
  jobUrl: string;
  setJobUrl: (value: string) => void;
  jobDescription: string;
  setJobDescription: (value: string) => void;
  setImportedJob: (value: ImportedJobSnapshot | null) => void;
  setResult: (value: PolishedResume | null) => void;
  resetCoverWorkflow: () => void;
  setPipelineAiUsage: (updater: (prev: Record<string, StageAiUsage>) => Record<string, StageAiUsage>) => void;
  setJobRawText: (value: string) => void;
  setPolishStatus: (value: string) => void;
  setLinkStatus: (value: string) => void;
  confirmDuplicateBeforeJobAnalysis: (
    url: string,
    text: string,
    facts: ExtractedJobTracking
  ) => Promise<{ proceed: boolean; note: string | null }>;
  confirmDuplicateAfterJobAnalysis: (
    url: string,
    text: string,
    facts: ExtractedJobTracking
  ) => Promise<{ proceed: boolean; note: string | null }>;
  jobAnalysisRequestFields: () => AiRequestFields;
  fitAssessmentRequestFields: () => AiRequestFields;
  ensureProviderReady: () => Promise<ProviderReadiness>;
  ensureFitAssessmentProviderReady: () => Promise<ProviderReadiness>;
  runFitAssessment: boolean;
  // The one authoritative resume resolution, ranked against the local
  // job-analysis brief and adopted into the editor BEFORE the provider request.
  // It runs on every preparation, not only when Fit Assessment is on: which resume
  // this application speaks for is a workflow fact, not a fit-check detail.
  resolvePreparedResume: (
    jobText: string,
    controls?: PreparedResumeResolutionControls
  ) => Promise<PreparedResumeSelection | null>;
  cancelPreparedResumeResolution: () => void;
  candidateContext: () => string;
  currentResume: () => Pick<PreparedResumeSelection, "text" | "label"> | null;
  extensionImportsReady: boolean;
  onExtensionPrepareStarted: () => void;
  onExtensionJobReceived: () => void;
};

type PreparedJobAnalysisSource = "link" | "paste" | "extension" | "retry";

type PreparedJobAnalysisRequest = {
  signal: AbortSignal;
  isCurrent: () => boolean;
};

type PreparedJobAnalysisOutcome =
  | { status: "stale" }
  | { status: "duplicate-before" }
  | { status: "too-short" }
  | {
      status: "complete" | "duplicate-after";
      result: JobAnalysisResult;
      relevant: string;
      duplicateNote: string | null;
    };

export function useJobIntake({
  jobUrl,
  setJobUrl,
  jobDescription,
  setJobDescription,
  setImportedJob,
  setResult,
  resetCoverWorkflow,
  setPipelineAiUsage,
  setJobRawText,
  setPolishStatus,
  setLinkStatus,
  confirmDuplicateBeforeJobAnalysis,
  confirmDuplicateAfterJobAnalysis,
  jobAnalysisRequestFields,
  fitAssessmentRequestFields,
  ensureProviderReady,
  ensureFitAssessmentProviderReady,
  runFitAssessment,
  resolvePreparedResume,
  cancelPreparedResumeResolution,
  candidateContext,
  currentResume,
  extensionImportsReady,
  onExtensionPrepareStarted,
  onExtensionJobReceived
}: UseJobIntakeArgs) {
  const [isExtractingLink, setIsExtractingLink] = useState(false);
  const [extensionImportPhase, setExtensionImportPhase] = useState<"receiving" | "preparing" | null>(null);
  const [localPreparedPreview, setLocalPreparedPreview] = useState<ImportedJobSnapshot | null>(null);
  // Job analysis progress row in the shared AI workflow. Driven by both
  // job-analysis entry points (link and pasted posting); the DONE card
  // reports whether the brief came from the AI or the local fallback.
  const [jobAnalysisProgress, setJobAnalysisProgress] = useState<StageState>({ status: "idle" });
  const [jobAnalysisProgressVisible, setJobAnalysisProgressVisible] = useState(false);
  const [fitAssessmentState, setFitAssessmentState] = useState<FitAssessmentState>(
    runFitAssessment ? { status: "unavailable", resumeLabel: "", message: "Prepare a job to run Fit Assessment." } : { status: "disabled" }
  );
  // Which job analysis action the card's Retry should re-run (link, paste, or a
  // reanalyze of an extension import). Stored as a tag, not a captured closure,
  // so Retry dispatches to the LIVE handler and picks up the current URL / paste
  // — a stored closure would re-run stale input the user has since edited. Null
  // only before any job analysis has run, so that card shows no Retry button.
  const [jobAnalysisRetrySource, setJobAnalysisRetrySource] = useState<"link" | "paste" | "import" | null>(null);
  // Raw source text + url of the last extension import, so its card's Retry can
  // reanalyze it through the CLIENT /api/job-analysis path — the extension import is
  // event-driven with no action to re-run otherwise.
  const jobAnalysisImportRef = useRef<{
    text: string;
    url: string;
  } | null>(null);
  // A once-only extension delivery cannot be put back into the server inbox,
  // so serialize every job analysis in memory. User actions reject while busy;
  // extension deliveries wait for the active run, retaining their captured
  // payload until they own the lock.
  const jobAnalysisBusyRef = useRef(false);
  const jobAnalysisSettledRef = useRef<Promise<void>>(Promise.resolve());
  const jobAnalysisGenerationRef = useRef(0);
  const jobAnalysisAbortRef = useRef<AbortController | null>(null);
  const fitAssessmentAbortRef = useRef<AbortController | null>(null);
  // The job texts the last preparation resolved a resume against: the local
  // brief for ranking, the posting the provider screens. Retry re-resolves
  // from these rather than requiring the posting to be prepared again.
  const preparedJobForFitRef = useRef<PreparedFitAssessmentJob | null>(null);
  // The stale-input guard tracks the job source, Fit Assessment setting, and
  // stage-local AI settings. The selected resume is captured immediately
  // before dispatch and is not allowed to mutate the in-flight request.
  const jobAnalysisInputFingerprint = workflowInputFingerprint({
    jobUrl,
    jobDescription,
    runFitAssessment,
    jobAnalysisRequest: jobAnalysisRequestFields(),
    fitAssessmentRequest: runFitAssessment ? fitAssessmentRequestFields() : null
  });
  const jobAnalysisInputFingerprintRef = useRef(jobAnalysisInputFingerprint);
  jobAnalysisInputFingerprintRef.current = jobAnalysisInputFingerprint;

  function startJobAnalysisRequest() {
    cancelPreparedResumeResolution();
    jobAnalysisGenerationRef.current += 1;
    jobAnalysisAbortRef.current?.abort();
    fitAssessmentAbortRef.current?.abort();
    fitAssessmentAbortRef.current = null;
    const controller = new AbortController();
    jobAnalysisAbortRef.current = controller;
    const generation = jobAnalysisGenerationRef.current;
    const fingerprint = jobAnalysisInputFingerprintRef.current;
    return {
      controller,
      signal: controller.signal,
      isCurrent: () => workflowRequestIsCurrent(
        generation,
        jobAnalysisGenerationRef.current,
        fingerprint,
        jobAnalysisInputFingerprintRef.current,
        controller.signal
      )
    };
  }

  function finishJobAnalysisRequest(controller: AbortController) {
    if (jobAnalysisAbortRef.current === controller) jobAnalysisAbortRef.current = null;
  }

  function restorePreparedFitAssessment(
    preparedJob: PreparedFitAssessmentJob,
    snapshot?: FitAssessmentSnapshot
  ) {
    // A tracker restore supersedes every request from the previous desk state.
    // Without this generation bump, a late Job analysis could replace the
    // restored posting and its historical assessment after Open completes.
    cancelPreparedResumeResolution();
    jobAnalysisGenerationRef.current += 1;
    jobAnalysisAbortRef.current?.abort();
    jobAnalysisAbortRef.current = null;
    fitAssessmentAbortRef.current?.abort();
    fitAssessmentAbortRef.current = null;
    preparedJobForFitRef.current = preparedJob;
    setLocalPreparedPreview(null);
    setJobAnalysisProgress({ status: "idle" });
    setJobAnalysisProgressVisible(false);
    setJobAnalysisRetrySource(null);
    setFitAssessmentState(restoredFitAssessmentState(runFitAssessment, snapshot));
  }

  useEffect(() => {
    if (!jobAnalysisAbortRef.current) return;
    cancelPreparedResumeResolution();
    jobAnalysisGenerationRef.current += 1;
    jobAnalysisAbortRef.current.abort();
    jobAnalysisAbortRef.current = null;
    setJobAnalysisProgress({
      status: "stopped",
      errorHeadline: "Inputs changed",
      error: "The active Job analysis was cancelled before it could replace the current job target."
    });
    setJobAnalysisProgressVisible(true);
    setLinkStatus("Job inputs changed. Prepare the current posting again.");
    settlePreparationFit({ status: "inputs-changed" });
  }, [cancelPreparedResumeResolution, jobAnalysisInputFingerprint, setLinkStatus]);

  useEffect(() => () => {
    jobAnalysisGenerationRef.current += 1;
    jobAnalysisAbortRef.current?.abort();
    jobAnalysisAbortRef.current = null;
    fitAssessmentAbortRef.current?.abort();
    fitAssessmentAbortRef.current = null;
  }, []);

  useEffect(() => {
    if (runFitAssessment) {
      setFitAssessmentState((current) => current.status === "disabled"
        ? preparedJobForFitRef.current
          ? restoredFitAssessmentState(true)
          : { status: "unavailable", resumeLabel: "", message: "Prepare the current posting to run Fit Assessment." }
        : current);
      return;
    }
    fitAssessmentAbortRef.current?.abort();
    fitAssessmentAbortRef.current = null;
    setFitAssessmentState({ status: "disabled" });
  }, [runFitAssessment]);

  function claimJobAnalysisRun(): () => void {
    jobAnalysisBusyRef.current = true;
    let resolve!: () => void;
    jobAnalysisSettledRef.current = new Promise<void>((done) => {
      resolve = done;
    });
    return () => {
      jobAnalysisBusyRef.current = false;
      resolve();
    };
  }

  function tryClaimJobAnalysisRun(): (() => void) | null {
    return jobAnalysisBusyRef.current ? null : claimJobAnalysisRun();
  }

  async function waitAndClaimJobAnalysisRun(): Promise<() => void> {
    while (jobAnalysisBusyRef.current) await jobAnalysisSettledRef.current;
    return claimJobAnalysisRun();
  }

  // Resolve the prepared resume for THIS preparation, then turn it into an
  // Fit Assessment request when the check is enabled. Resolution is unconditional:
  // turning Fit Assessment off must not stop the workflow from loading the resume
  // this application will be tailored from.
  async function prepareResumeAndFitAssessment(
    localJobText: string,
    screeningJobText: string,
    request: PreparedJobAnalysisRequest
  ): Promise<FitAssessmentRequest | null> {
    const selection = await resolvePreparedResume(localJobText, {
      signal: request.signal,
      isCurrent: request.isCurrent
    });
    if (!request.isCurrent()) return null;
    preparedJobForFitRef.current = { localJobText, screeningJobText };
    if (!runFitAssessment) {
      setFitAssessmentState({ status: "disabled" });
      return null;
    }
    // Assessment stays available even here: this preparation is real, and the
    // user can open or save a resume without preparing the posting again.
    if (!selection) {
      setFitAssessmentState({
        status: "unavailable",
        resumeLabel: "",
        message: "Fit Assessment needs your own resume. Open or save one, then retry the assessment."
      });
      return null;
    }
    const fitRequest: FitAssessmentRequest = {
      resumeText: selection.text,
      resumeLabel: selection.label,
      candidateContext: candidateContext()
    };
    setFitAssessmentState({ status: "running", resumeLabel: fitRequest.resumeLabel });
    return fitRequest;
  }

  function settlePreparationFit({
    status,
    fitRequest
  }: {
    status: "too-short" | "failed" | "stopped" | "inputs-changed";
    fitRequest?: FitAssessmentRequest | null;
  }) {
    if (!runFitAssessment) {
      setFitAssessmentState({ status: "disabled" });
      return;
    }
    const message = status === "stopped"
      ? "Fit Assessment stopped with Job analysis. Prepare again or retry the assessment."
      : status === "inputs-changed"
        ? "Fit Assessment stopped because the preparation inputs changed. Prepare again or retry the assessment."
        : status === "too-short"
          ? "Fit Assessment stopped because the posting did not contain enough job-relevant text."
          : "Fit Assessment stopped because preparation failed. Prepare again or retry the assessment.";
    setFitAssessmentState((current) => {
      if (current.status !== "running") return current;
      if (fitRequest && current.resumeLabel !== fitRequest.resumeLabel) return current;
      return {
        status: "unavailable",
        resumeLabel: current.resumeLabel,
        message
      };
    });
  }

  function applyFitAssessmentOutcome({
    outcome,
    fitRequest,
    screeningJobText,
    aiRequest,
    executionUsage,
    autoPolishEligible = false,
    unavailableMessage = "Fit Assessment is unavailable. You can continue to Polish or retry the assessment."
  }: {
    outcome: FitAssessmentResult | null;
    fitRequest: FitAssessmentRequest | null;
    screeningJobText: string;
    aiRequest: AiRequestFields;
    executionUsage?: FitAssessmentExecutionUsage;
    autoPolishEligible?: boolean;
    unavailableMessage?: string;
  }) {
    if (!runFitAssessment) {
      setFitAssessmentState({ status: "disabled" });
      return;
    }
    if (!fitRequest) return;
    if (outcome) {
      setFitAssessmentState({
        status: "ready",
        snapshot: {
          result: outcome,
          resumeLabel: fitRequest.resumeLabel,
          assessedAt: new Date().toISOString(),
          provider: executionUsage?.provider ?? aiRequest.provider,
          model: executionUsage?.model ?? aiRequest.model,
          reasoningEffort: executionUsage?.reasoningEffort ?? aiRequest.reasoningEffort,
          ...(executionUsage?.attempts ? { attempts: executionUsage.attempts } : {}),
          promptVersion: FIT_ASSESSMENT_PROMPT_VERSION
        },
        provenance: createFitAssessmentProvenance(
          screeningJobText,
          fitRequest,
          aiRequest
        ),
        autoPolishEligible
      });
      return;
    }
    setFitAssessmentState({
      status: "unavailable",
      resumeLabel: fitRequest.resumeLabel,
      message: unavailableMessage
    });
  }

  async function evaluateFitAssessment(
    screeningJobText: string,
    fitRequest: FitAssessmentRequest,
    { autoPolishEligible = false }: { autoPolishEligible?: boolean } = {}
  ) {
    if (!runFitAssessment) {
      setFitAssessmentState({ status: "disabled" });
      return;
    }
    fitAssessmentAbortRef.current?.abort();
    const controller = new AbortController();
    fitAssessmentAbortRef.current = controller;
    const aiRequest = fitAssessmentRequestFields();
    setFitAssessmentState({ status: "running", resumeLabel: fitRequest.resumeLabel });
    try {
      const readiness = await ensureFitAssessmentProviderReady();
      if (controller.signal.aborted) return;
      if (!readiness.ready) {
        applyFitAssessmentOutcome({
          outcome: null,
          fitRequest,
          screeningJobText,
          aiRequest,
          autoPolishEligible,
          unavailableMessage: `Fit Assessment is unavailable: ${readiness.message}`
        });
        return;
      }
      const outcome = await analyzeFitAssessment(screeningJobText, fitRequest, {
        aiRequest,
        signal: controller.signal
      });
      if (controller.signal.aborted) return;
      applyFitAssessmentOutcome({
        outcome: outcome.fitAssessment,
        fitRequest,
        screeningJobText,
        aiRequest,
        executionUsage: outcome.usage,
        autoPolishEligible
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      applyFitAssessmentOutcome({
        outcome: null,
        fitRequest,
        screeningJobText,
        aiRequest,
        autoPolishEligible
      });
    } finally {
      if (fitAssessmentAbortRef.current === controller) fitAssessmentAbortRef.current = null;
    }
  }

  function assessFitForResume(
    selection: Pick<PreparedResumeSelection, "text" | "label">
  ): void {
    const prepared = preparedJobForFitRef.current;
    if (!runFitAssessment || !prepared) return;
    void evaluateFitAssessment(prepared.screeningJobText, {
      resumeText: selection.text,
      resumeLabel: selection.label,
      candidateContext: candidateContext()
    });
  }

  async function reassessFit() {
    const prepared = preparedJobForFitRef.current;
    if (!runFitAssessment || !prepared) return;
    await dispatchFitAssessment({
      preparedJob: prepared,
      currentResume,
      resolvePreparedResume,
      candidateContext,
      onUnavailable: () => setFitAssessmentState({
        status: "unavailable",
        resumeLabel: "",
        message: "Fit Assessment needs your own resume. Open or save one, then retry the assessment."
      }),
      refresh: evaluateFitAssessment
    });
  }

  const currentPrepared = preparedJobForFitRef.current;
  const currentSelection = currentResume();
  const fitAssessmentChanges = fitAssessmentState.status === "ready" && currentPrepared
    ? fitAssessmentProvenanceChanges(
        fitAssessmentState.provenance,
        currentPrepared.screeningJobText,
        currentSelection,
        candidateContext(),
        fitAssessmentRequestFields()
      )
    : [];
  const visibleFitAssessmentState: FitAssessmentState = fitAssessmentState.status === "ready"
    && fitAssessmentChanges.length > 0
    ? {
        status: "stale",
        snapshot: fitAssessmentState.snapshot,
        changes: fitAssessmentChanges
      }
    : fitAssessmentState;

  function jobAnalysisTerminalState(result: JobAnalysisResult, duplicateNote?: string | null): StageState {
    if (result.failure) {
      return {
        status: "done",
        noteTone: "warn",
        note: `Local brief ready · ${result.failure.headline}. You can continue or retry AI Job Analysis.`
      };
    }
    const base: StageState = result.source === "ai"
      ? { status: "done", note: "Analyzed with AI", noteTone: "ok" }
      : { status: "done", note: "Local extraction used; no AI request was made", noteTone: "info" };
    if (!duplicateNote) return base;
    return { ...base, noteTone: "warn", note: `${base.note} · Already tracked: ${duplicateNote}` };
  }

  function duplicateStoppedState(phase: "before" | "after"): StageState {
    return {
      status: "stopped",
      errorHeadline: "Duplicate application found",
      error: phase === "before"
        ? "Pipeline stopped before Job analysis. No AI request was made."
        : "Job analysis completed. Polish was not started."
    };
  }

  function dismissJobAnalysisProgress() {
    setJobAnalysisProgressVisible(false);
  }

  function stopJobAnalysis() {
    const controller = jobAnalysisAbortRef.current;
    if (!controller) return;
    cancelPreparedResumeResolution();
    jobAnalysisGenerationRef.current += 1;
    controller.abort();
    jobAnalysisAbortRef.current = null;
    fitAssessmentAbortRef.current?.abort();
    fitAssessmentAbortRef.current = null;
    setIsExtractingLink(false);
    setJobAnalysisProgress({
      status: "stopped",
      errorHeadline: "Stopped",
      error: "Job analysis was cancelled. The unfinished result did not replace your prepared job."
    });
    setLinkStatus("Job analysis stopped. Prepare again when you are ready.");
    settlePreparationFit({ status: "stopped" });
  }

  // Prepare's direct-typing path (manual edits to the description textarea) —
  // NOT used by the job analysis entry points above, which call the raw
  // setJobDescription and set pipelineAiUsage["job-analysis"] to their own real usage.
  // A manual edit means whatever job analysis result was showing no longer describes
  // the text on screen, and there is no separate raw version to remember.
  // Deliberately keep later-stage usage: a manual edit leaves those outputs on
  // screen, so their attribution still describes what the user can see.
  function handleManualJobDescriptionChange(value: string) {
    cancelPreparedResumeResolution();
    setJobDescription(value);
    // Typing or replacing source starts fresh intake immediately. Clear the
    // prepared snapshot so App also releases any restored/applied application
    // link before a document can be saved against the wrong posting.
    setImportedJob(null);
    setPipelineAiUsage((prev) => ({ ...prev, "job-analysis": { source: "none" } }));
    setJobRawText("");
    setLocalPreparedPreview(null);
    preparedJobForFitRef.current = null;
    setFitAssessmentState(runFitAssessment
      ? { status: "unavailable", resumeLabel: "", message: "Prepare the current posting to run Fit Assessment." }
      : { status: "disabled" });
  }

  // Fresh intake clears every downstream output, so its usage snapshot starts
  // with Job analysis only. Replacing the map prevents any current or future
  // job-specific stage from leaking attribution across postings.
  const freshJobAnalysisUsage = (usage: StageAiUsage) => () => ({
    "job-analysis": usage
  });

  async function runPreparedJobAnalysis({
    source,
    url,
    localSourceText,
    screeningJobText,
    readiness,
    request
  }: {
    source: PreparedJobAnalysisSource;
    url: string;
    localSourceText: string;
    screeningJobText: string;
    readiness: ProviderReadiness;
    request: PreparedJobAnalysisRequest;
  }): Promise<PreparedJobAnalysisOutcome> {
    const localExtracted = extractJobPosting(localSourceText, { url: url || undefined });
    const duplicateBefore = await confirmDuplicateBeforeJobAnalysis(
      url,
      localSourceText,
      localExtracted.tracking
    );
    if (!request.isCurrent()) return { status: "stale" };
    if (!duplicateBefore.proceed) {
      // Extension delivery can contain a short intermediate payload. The URL
      // and paste paths have already enforced their own acquisition floors.
      if (source === "link" || source === "paste" || localSourceText.trim().length >= 40) {
        applyRawImportedJob(localSourceText.trim(), url);
      }
      return { status: "duplicate-before" };
    }

    if (source === "extension") {
      setJobAnalysisProgress({ status: "running" });
      setJobAnalysisProgressVisible(true);
    }

    const jobAnalysisAiRequest = jobAnalysisRequestFields();
    const fitAssessmentAiRequest = fitAssessmentRequestFields();
    // Rank against the compact local brief, while the provider and Fit
    // provenance retain the complete captured posting.
    const localJobText = localExtracted.tailoringText;
    setLocalPreparedPreview(importedJobSnapshot(url, localJobText, localExtracted, screeningJobText));
    const fitRequest = await prepareResumeAndFitAssessment(localJobText, screeningJobText, request);
    if (!request.isCurrent()) return { status: "stale" };
    // Preserve Prepare's one-call fast path only when the two independently
    // configured stages resolve to the exact same provider request. A distinct
    // Fit Assessment config must never be silently replaced by Job analysis's.
    const combineFitAssessment = Boolean(fitRequest)
      && aiRequestFieldsMatch(jobAnalysisAiRequest, fitAssessmentAiRequest);

    const result = readiness.ready
      ? await analyzeJobPosting(screeningJobText, {
          url: url || undefined,
          aiRequest: jobAnalysisAiRequest,
          fitAssessment: combineFitAssessment ? fitRequest ?? undefined : undefined,
          localExtracted,
          signal: request.signal
        })
      : localJobAnalysisResult(screeningJobText, {
          url: url || undefined,
          aiRequest: jobAnalysisAiRequest,
          localExtracted,
          fitAssessmentRequested: combineFitAssessment,
          failure: classifyFailure(new ApiError(readiness.message, 503))
        });
    if (!request.isCurrent()) return { status: "stale" };

    const relevant = result.extracted.tailoringText;
    if (relevant.trim().length < 40) {
      settlePreparationFit({ status: "too-short", fitRequest });
      return { status: "too-short" };
    }

    const duplicateAfter = result.failure
      ? duplicateBefore
      : await confirmDuplicateAfterJobAnalysis(
          url,
          screeningJobText,
          result.extracted.tracking
        );
    if (!request.isCurrent()) return { status: "stale" };

    // Extension payloads are not already bound to the live URL input.
    if (source === "extension" || source === "retry") setJobUrl(url);
    setJobDescription(relevant);
    setImportedJob(importedJobSnapshot(url, relevant, result.extracted, screeningJobText));
    setLocalPreparedPreview(null);
    setResult(null);
    resetCoverWorkflow();
    setPipelineAiUsage(freshJobAnalysisUsage(result.usage));
    setJobRawText(screeningJobText);
    if (combineFitAssessment) {
      applyFitAssessmentOutcome({
        outcome: result.fitAssessment,
        fitRequest,
        screeningJobText,
        aiRequest: fitAssessmentAiRequest,
        executionUsage: result.usage,
        autoPolishEligible: duplicateAfter.proceed
      });
    } else if (fitRequest) {
      if (duplicateAfter.proceed) {
        // Job analysis is already committed. Let the separately configured Fit
        // stage settle independently without holding Prepare's brief/progress open.
        void evaluateFitAssessment(screeningJobText, fitRequest, { autoPolishEligible: true });
      } else {
        applyFitAssessmentOutcome({
          outcome: null,
          fitRequest,
          screeningJobText,
          aiRequest: fitAssessmentAiRequest,
          unavailableMessage: "Fit Assessment did not run because duplicate review stopped Prepare."
        });
      }
    }

    return {
      status: duplicateAfter.proceed ? "complete" : "duplicate-after",
      result,
      relevant,
      duplicateNote: duplicateAfter.note
    };
  }

  async function handleExtractFromLink() {
    const url = jobUrl.trim();
    if (!url) return;
    const readinessInputFingerprint = jobAnalysisInputFingerprintRef.current;
    const readiness = await ensureProviderReady();
    if (readinessInputFingerprint !== jobAnalysisInputFingerprintRef.current) {
      setLinkStatus("Job inputs changed while AI setup was being checked. Prepare the current posting again.");
      return;
    }
    if (!readiness.ready) {
      setJobAnalysisRetrySource("link");
    }
    const releaseJobAnalysisRun = tryClaimJobAnalysisRun();
    if (!releaseJobAnalysisRun) return;
    const request = startJobAnalysisRequest();
    setIsExtractingLink(true);
    setJobAnalysisRetrySource("link");
    setJobAnalysisProgress({ status: "running" });
    setJobAnalysisProgressVisible(true);
    setLinkStatus("Fetching the posting…");
    try {
      const response = await fetch("/api/import-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: request.signal
      });
      const data = await response.json();
      if (!request.isCurrent()) return;
      if (!response.ok) throw new Error(data.error ?? "Could not read that link.");
      // AI job analyzer (server-side keys) trims the scraped page to the parts worth
      // polishing and extracts tracker details; falls back to the deterministic
      // engine on any failure so a link import always produces a brief.
      setLinkStatus("Preparing job details…");
      const rawText = String(data.text ?? "");
      const outcome = await runPreparedJobAnalysis({
        source: "link",
        url,
        localSourceText: rawText,
        screeningJobText: rawText,
        readiness,
        request
      });
      if (outcome.status === "stale") return;
      if (outcome.status === "duplicate-before") {
        setJobAnalysisProgress(duplicateStoppedState("before"));
        setLinkStatus("Preparation stopped because this application is already tracked.");
        return;
      }
      if (outcome.status === "too-short") {
        setLinkStatus("Fetched the page, but found too little job text. Paste the description instead.");
        setJobAnalysisProgress({
          status: "failed",
          errorHeadline: "Missing input",
          error: "Too little job text was found on that page. Paste the description instead."
        });
        setImportedJob(null);
        return;
      }
      if (outcome.status === "duplicate-after") {
        setJobAnalysisProgress(duplicateStoppedState("after"));
        setLinkStatus("Job details were prepared, then the workflow stopped because this application is already tracked.");
        return;
      }
      const missing = compactManualReviewFields(outcome.result.extracted.manualReviewFields);
      setLinkStatus(outcome.result.failure
        ? `${outcome.result.failure.headline}: ${outcome.result.failure.detail}. The local brief is ready, and you can continue to Polish.`
        : `Prepared ${outcome.relevant.length.toLocaleString()} compact characters for tailoring and captured ${presentTrackingFields(
            outcome.result.extracted.tracking
          )}${missing ? `; add ${missing} manually if needed` : ""}.`);
      setJobAnalysisProgress(jobAnalysisTerminalState(outcome.result, outcome.duplicateNote));
    } catch (error) {
      if (!request.isCurrent()) return;
      settlePreparationFit({ status: "failed" });
      const message = error instanceof Error ? error.message.replace(/[.。]\s*$/, "") : "request failed";
      setImportedJob(null);
      setLinkStatus(`Couldn't extract from the link: ${message}. Paste the description instead.`);
      const f = classifyFailure(error);
      setJobAnalysisProgress({
        status: "failed",
        errorHeadline: f.headline,
        error: `${f.detail}. Paste the description instead.`
      });
    } finally {
      finishJobAnalysisRequest(request.controller);
      setIsExtractingLink(false);
      releaseJobAnalysisRun();
    }
  }

  // Analyze whatever the user pasted into the Job posting box through the same
  // pipeline the link path uses. Covers JDs the server can't fetch (Workday
  // wd1 tenants, ADP, anything JS-only): user copies the visible page text from
  // their browser, pastes it in, and gets the structured brief plus tracking.
  async function handleAnalyzePaste(sourceOverride?: string) {
    const raw = sourceOverride ?? jobDescription;
    if (!raw.trim() || jobAnalysisBusyRef.current) return;
    const readinessInputFingerprint = jobAnalysisInputFingerprintRef.current;
    const readiness = await ensureProviderReady();
    if (readinessInputFingerprint !== jobAnalysisInputFingerprintRef.current) {
      setLinkStatus("Job inputs changed while AI setup was being checked. Prepare the current posting again.");
      return;
    }
    if (!readiness.ready) {
      setJobAnalysisRetrySource("paste");
    }
    // Strip HTML tags only if the paste looks tag-shaped (text from "View
    // source" or a copied editor block). Plain copy-paste from a rendered page
    // doesn't need this and passes through untouched.
    const looksLikeHtml = /<\/?[a-z][\s\S]{0,40}>/i.test(raw) && raw.split("<").length > 5;
    const cleaned = looksLikeHtml
      ? raw
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<\/(p|div|li|h[1-6]|ul|ol|tr|section|header|footer|article)>/gi, "\n")
          .replace(/<li[^>]*>/gi, "\n• ")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/gi, " ")
          .replace(/&amp;/gi, "&")
          .replace(/&lt;/gi, "<")
          .replace(/&gt;/gi, ">")
          .replace(/&quot;|&#39;/gi, '"')
      : raw;
    if (cleaned.trim().length < 80) {
      setLinkStatus("Paste a bit more job text first. Preparation needs a real description to work from.");
      return;
    }
    const releaseJobAnalysisRun = tryClaimJobAnalysisRun();
    if (!releaseJobAnalysisRun) return;
    const request = startJobAnalysisRequest();
    setIsExtractingLink(true);
    setJobAnalysisRetrySource("paste");
    setJobAnalysisProgress({ status: "running" });
    setJobAnalysisProgressVisible(true);
    setLinkStatus("Preparing the pasted posting…");
    try {
      const trimmedUrl = jobUrl.trim();
      const outcome = await runPreparedJobAnalysis({
        source: "paste",
        url: trimmedUrl,
        localSourceText: cleaned,
        screeningJobText: cleaned,
        readiness,
        request
      });
      if (outcome.status === "stale") return;
      if (outcome.status === "duplicate-before") {
        setJobAnalysisProgress(duplicateStoppedState("before"));
        setLinkStatus("Preparation stopped because this application is already tracked.");
        return;
      }
      if (outcome.status === "too-short") {
        setLinkStatus("Couldn't find enough job-relevant text in the paste. Check that you copied the description, not just the page header.");
        setJobAnalysisProgress({
          status: "failed",
          errorHeadline: "Missing input",
          error: "Couldn't find enough job-relevant text in the paste."
        });
        return;
      }
      if (outcome.status === "duplicate-after") {
        setJobAnalysisProgress(duplicateStoppedState("after"));
        setLinkStatus("Job details were prepared, then the workflow stopped because this application is already tracked.");
        return;
      }
      const missing = compactManualReviewFields(outcome.result.extracted.manualReviewFields);
      setLinkStatus(outcome.result.failure
        ? `${outcome.result.failure.headline}: ${outcome.result.failure.detail}. The local brief is ready, and you can continue to Polish.`
        : `Prepared ${outcome.relevant.length.toLocaleString()} compact characters from the paste and captured ${presentTrackingFields(
            outcome.result.extracted.tracking
          )}${missing ? `; add ${missing} manually if needed` : ""}.`);
      setJobAnalysisProgress(jobAnalysisTerminalState(outcome.result, outcome.duplicateNote));
    } catch (error) {
      if (!request.isCurrent()) return;
      settlePreparationFit({ status: "failed" });
      // analyzeJobPosting is built to fall back to local rather than throw, so
      // this only fires on an unexpected error — surface it instead of leaving
      // the card stuck on "running".
      const message = error instanceof Error ? error.message.replace(/[.。]\s*$/, "") : "job analysis failed";
      setLinkStatus(`Couldn't prepare the pasted posting: ${message}.`);
      const f = classifyFailure(error);
      setJobAnalysisProgress({ status: "failed", errorHeadline: f.headline, error: f.detail });
    } finally {
      finishJobAnalysisRequest(request.controller);
      setIsExtractingLink(false);
      releaseJobAnalysisRun();
    }
  }

  // Preserve the captured source when a duplicate gate stops before Job analysis.
  // Normal extension intake always goes through provider-backed AI job analysis;
  // this raw snapshot is only the pre-analysis duplicate-stop view.
  function applyRawImportedJob(rawTrimmed: string, trimmedUrl: string) {
    const localExtracted = extractJobPosting(rawTrimmed, { url: trimmedUrl || undefined });
    setJobUrl(trimmedUrl);
    setJobDescription(rawTrimmed);
    setImportedJob(importedJobSnapshot(trimmedUrl, rawTrimmed, localExtracted, rawTrimmed));
    setResult(null);
    resetCoverWorkflow();
    setPipelineAiUsage(freshJobAnalysisUsage({ source: "none", completedAt: new Date().toISOString() }));
    setJobRawText(rawTrimmed);
    setJobAnalysisProgress({
      status: "done",
      note: "Raw description retained for duplicate review",
      noteTone: "info"
    });
    preparedJobForFitRef.current = null;
    setFitAssessmentState(runFitAssessment
      ? { status: "unavailable", resumeLabel: "", message: "Fit Assessment did not run because duplicate review stopped Prepare." }
      : { status: "disabled" });
  }

  // Retry an extension-import analysis by re-running provider-backed AI job analysis
  // against its stored raw text. The extension import is event-driven, so this
  // gives its card a working retry after a provider or request failure.
  async function retryImportedJobAnalysis() {
    const payload = jobAnalysisImportRef.current;
    if (!payload) return;
    const readiness = await ensureProviderReady();
    if (!readiness.ready) {
      setJobAnalysisRetrySource("import");
    }
    const releaseJobAnalysisRun = tryClaimJobAnalysisRun();
    if (!releaseJobAnalysisRun) return;
    const request = startJobAnalysisRequest();
    setIsExtractingLink(true);
    setJobAnalysisRetrySource("import");
    setJobAnalysisProgress({ status: "running" });
    setJobAnalysisProgressVisible(true);
    try {
      const rawTrimmed = payload.text.trim();
      if (rawTrimmed.length < 40) {
        setJobAnalysisProgress({
          status: "failed",
          errorHeadline: "Missing input",
          error: "The imported posting had too little job text. Paste it manually."
        });
        return;
      }
      const outcome = await runPreparedJobAnalysis({
        source: "retry",
        url: payload.url,
        localSourceText: payload.text,
        screeningJobText: payload.text,
        readiness,
        request
      });
      if (outcome.status === "stale") return;
      if (outcome.status === "duplicate-before") {
        setJobAnalysisProgress(duplicateStoppedState("before"));
        setPolishStatus("Preparation stopped because this application is already tracked.");
        return;
      }
      if (outcome.status === "too-short") {
        setJobAnalysisProgress({
          status: "failed",
          errorHeadline: "Missing input",
          error: "The imported posting had too little job text. Paste it manually."
        });
        return;
      }
      if (outcome.status === "duplicate-after") {
        setJobAnalysisProgress(duplicateStoppedState("after"));
        setPolishStatus("Job details were prepared, then the workflow stopped because this application is already tracked.");
        return;
      }
      setJobAnalysisProgress(jobAnalysisTerminalState(outcome.result, outcome.duplicateNote));
      setPolishStatus(outcome.result.failure
        ? `${outcome.result.failure.headline}: ${outcome.result.failure.detail}. The local brief is ready, and you can continue to Polish.`
        : "Application prepared from the browser extension.");
    } catch (error) {
      if (!request.isCurrent()) return;
      settlePreparationFit({ status: "failed" });
      const f = classifyFailure(error);
      setJobAnalysisProgress({ status: "failed", errorHeadline: f.headline, error: f.detail });
      setPolishStatus(`The extension posting could not be prepared: ${f.detail}. Retry from the workflow card.`);
    } finally {
      finishJobAnalysisRequest(request.controller);
      setIsExtractingLink(false);
      releaseJobAnalysisRun();
    }
  }

  // Auto-fill the job description from the browser extension inbox. Provider
  // readiness is required before the tab runs AI job analysis; its deterministic
  // brief is retained only when that AI request fails.
  useExtensionInbox(
    async (item: ExtensionImport) => {
      onExtensionJobReceived();
      setExtensionImportPhase("preparing");
      const { text, url } = item;
      const trimmedUrl = url.trim();
      jobAnalysisImportRef.current = { text, url: trimmedUrl };
      setJobAnalysisRetrySource("import");
      const readiness = await ensureProviderReady();
      const releaseJobAnalysisRun = await waitAndClaimJobAnalysisRun();
      const request = startJobAnalysisRequest();
      setIsExtractingLink(true);
      try {
        const outcome = await runPreparedJobAnalysis({
          source: "extension",
          url: trimmedUrl,
          localSourceText: text.trim(),
          screeningJobText: text,
          readiness,
          request
        });
        if (outcome.status === "stale") return;
        if (outcome.status === "duplicate-before") {
          setJobAnalysisProgress(duplicateStoppedState("before"));
          setJobAnalysisProgressVisible(true);
          setPolishStatus("Preparation stopped because this application is already tracked.");
          return;
        }
        if (outcome.status === "too-short") {
          setPolishStatus("The extension posting had too little job text. Paste it manually.");
          setJobAnalysisRetrySource("import");
          setJobAnalysisProgress({
            status: "failed",
            errorHeadline: "Missing input",
            error: "The imported posting had too little job text. Paste it manually."
          });
          setJobAnalysisProgressVisible(true);
          return;
        }
        if (outcome.status === "duplicate-after") {
          setJobAnalysisRetrySource("import");
          setJobAnalysisProgress(duplicateStoppedState("after"));
          setJobAnalysisProgressVisible(true);
          setPolishStatus("Job details were prepared, then the workflow stopped because this application is already tracked.");
          return;
        }
        // A successful or locally-fallback job analysis stops here. Polish
        // remains an explicit action in Prepare.
        const terminalState = jobAnalysisTerminalState(outcome.result, outcome.duplicateNote);
        setJobAnalysisRetrySource("import");
        setJobAnalysisProgress(terminalState);
        setJobAnalysisProgressVisible(true);
        setPolishStatus(outcome.result.failure
          ? `${outcome.result.failure.headline}: ${outcome.result.failure.detail}. The local brief is ready, and you can continue to Polish.`
          : "Application prepared from the browser extension.");
      } catch (error) {
        if (!request.isCurrent()) return;
        settlePreparationFit({ status: "failed" });
        const failure = classifyFailure(error);
        setJobAnalysisRetrySource("import");
        setJobAnalysisProgress({ status: "failed", errorHeadline: failure.headline, error: failure.detail });
        setJobAnalysisProgressVisible(true);
        setPolishStatus(`The extension posting could not be prepared: ${failure.detail}. Retry from the workflow card.`);
      } finally {
        finishJobAnalysisRequest(request.controller);
        setIsExtractingLink(false);
        setExtensionImportPhase(null);
        releaseJobAnalysisRun();
      }
    },
    () => {
      onExtensionPrepareStarted();
      setExtensionImportPhase("receiving");
      // Background server-side preparation is still running — surface it on the
      // same card the link/paste flows use. Guard the running state so repeated
      // polls don't churn renders.
      if (jobAnalysisBusyRef.current) return;
      setJobAnalysisRetrySource(null);
      setJobAnalysisProgress((prev) => (prev.status === "running" ? prev : { status: "running" }));
      setJobAnalysisProgressVisible(true);
    },
    extensionImportsReady
  );

  // Resolve the job analysis card's Retry to the live handler for the last action, so
  // it re-runs against the CURRENT url / paste rather than a stale captured one.
  const jobAnalysisRetry =
    jobAnalysisRetrySource === "link"
      ? handleExtractFromLink
      : jobAnalysisRetrySource === "paste"
        ? handleAnalyzePaste
        : jobAnalysisRetrySource === "import"
          ? retryImportedJobAnalysis
          : undefined;

  return {
    isExtractingLink,
    extensionImportPhase,
    jobAnalysisProgress,
    jobAnalysisProgressVisible,
    dismissJobAnalysisProgress,
    stopJobAnalysis,
    jobAnalysisRetry,
    fitAssessmentState: visibleFitAssessmentState,
    restorePreparedFitAssessment,
    reassessFit,
    // Assessment is offered whenever a prepared posting exists, even when no
    // resume resolved and the unavailable state therefore has no label.
    canAssessFit: fitAssessmentCanRun(runFitAssessment, preparedJobForFitRef.current),
    assessFitForResume,
    localPreparedPreview,
    handleManualJobDescriptionChange,
    handleExtractFromLink,
    handleAnalyzePaste
  };
}
