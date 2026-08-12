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
import type { PreparedSourceCandidate } from "../lib/preparedSourceReplacement.ts";
import {
  beginFitAssessmentRun,
  completeFitAssessmentRun,
  consumeFitAssessmentAutomationToken,
  createFitAssessmentProvenance,
  dispatchFitAssessment,
  emptyFitAssessmentState,
  failFitAssessmentRun,
  fitAssessmentCanRun,
  fitAssessmentProvenanceChanges,
  restoredFitAssessmentState,
  setFitAssessmentEnabled,
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
  jobRawText: string;
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
  ) => Promise<{ proceed: boolean; note: string | null; handled?: boolean }>;
  confirmDuplicateAfterJobAnalysis: (
    url: string,
    text: string,
    facts: ExtractedJobTracking
  ) => Promise<{ proceed: boolean; note: string | null; handled?: boolean }>;
  confirmPreparedSourceReplacement: (
    candidate: PreparedSourceCandidate
  ) => Promise<"continue" | "keep-current" | "cancel">;
  jobAnalysisRequestFields: () => AiRequestFields;
  fitAssessmentRequestFields: () => AiRequestFields;
  ensureProviderReady: (request: AiRequestFields) => Promise<ProviderReadiness>;
  ensureFitAssessmentProviderReady: (request: AiRequestFields) => Promise<ProviderReadiness>;
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

type PreparationRun = {
  id: string;
  draft: {
    url: string;
    sourceText: string;
  };
  preparedJob: PreparedFitAssessmentJob;
  selectedResume: Pick<PreparedResumeSelection, "text" | "label"> | null;
};

type JobAnalysisExecutionContext = {
  fingerprint: string;
  jobRequest: AiRequestFields;
  fitRequest: AiRequestFields;
  readiness: ProviderReadiness;
};

type PreparedJobAnalysisRequest = {
  signal: AbortSignal;
  isCurrent: () => boolean;
  expectInputFingerprint: (fingerprint: string) => void;
};

type PreparedResumeAndFit = {
  selection: PreparedResumeSelection | null;
  fitRequest: FitAssessmentRequest | null;
  fitRunId: string | null;
};

type PreparedJobAnalysisOutcome =
  | { status: "stale" }
  | { status: "source-replacement-stopped"; choice: "keep-current" | "cancel" }
  | { status: "duplicate-handled" }
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
  jobRawText,
  setImportedJob,
  setResult,
  resetCoverWorkflow,
  setPipelineAiUsage,
  setJobRawText,
  setPolishStatus,
  setLinkStatus,
  confirmDuplicateBeforeJobAnalysis,
  confirmDuplicateAfterJobAnalysis,
  confirmPreparedSourceReplacement,
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
    () => emptyFitAssessmentState(runFitAssessment)
  );
  // Which job analysis action the card's Retry should re-run (link, paste, or a
  // reanalyze of an extension import). Stored as a tag, not a captured closure,
  // so Retry dispatches to the LIVE handler and picks up the current URL / paste
  // — a stored closure would re-run stale input the user has since edited. Null
  // only before any job analysis has run, so that card shows no Retry button.
  const [jobAnalysisRetrySource, setJobAnalysisRetrySource] = useState<"link" | "paste" | "import" | null>(null);
  const [committedPreparation, setCommittedPreparation] = useState<PreparationRun | null>(null);
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
  // One committed preparation owns its captured posting, exact selected resume,
  // and run identity. Draft source fields stay
  // separate, so replacing them can mark this run previous without destroying it.
  const committedPreparationRef = useRef<PreparationRun | null>(null);
  committedPreparationRef.current = committedPreparation;
  const draftInputRef = useRef({
    url: jobUrl.trim(),
    sourceText: jobRawText.trim() || jobDescription.trim()
  });
  draftInputRef.current = {
    url: jobUrl.trim(),
    sourceText: jobRawText.trim() || jobDescription.trim()
  };
  const prepareRunSequenceRef = useRef(0);
  const fitRunSequenceRef = useRef(0);
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
  const jobAnalysisExpectedFingerprintRef = useRef(jobAnalysisInputFingerprint);

  function startJobAnalysisRequest() {
    cancelPreparedResumeResolution();
    jobAnalysisGenerationRef.current += 1;
    jobAnalysisAbortRef.current?.abort();
    fitAssessmentAbortRef.current?.abort();
    fitAssessmentAbortRef.current = null;
    setFitAssessmentState((current) => current.activeRun
      ? failFitAssessmentRun(current, current.activeRun.id, {
          resumeLabel: current.activeRun.resumeLabel,
          message: "Fit Assessment stopped because a new Prepare started."
        })
      : current);
    const controller = new AbortController();
    jobAnalysisAbortRef.current = controller;
    const generation = jobAnalysisGenerationRef.current;
    jobAnalysisExpectedFingerprintRef.current = jobAnalysisInputFingerprintRef.current;
    return {
      controller,
      signal: controller.signal,
      isCurrent: () => workflowRequestIsCurrent(
        generation,
        jobAnalysisGenerationRef.current,
        jobAnalysisExpectedFingerprintRef.current,
        jobAnalysisInputFingerprintRef.current,
        controller.signal
      ),
      expectInputFingerprint: (fingerprint: string) => {
        jobAnalysisExpectedFingerprintRef.current = fingerprint;
      }
    };
  }

  function finishJobAnalysisRequest(controller: AbortController) {
    if (jobAnalysisAbortRef.current === controller) jobAnalysisAbortRef.current = null;
  }

  function nextPrepareIdentity() {
    prepareRunSequenceRef.current += 1;
    const suffix = prepareRunSequenceRef.current.toString(36);
    return {
      prepareRunId: `prepare-${suffix}`,
      automationToken: `prepare-automation-${suffix}`
    };
  }

  function nextFitRunId(): string {
    fitRunSequenceRef.current += 1;
    return `fit-${fitRunSequenceRef.current.toString(36)}`;
  }

  function commitPreparation(run: PreparationRun | null) {
    committedPreparationRef.current = run;
    setCommittedPreparation(run);
  }

  async function createJobAnalysisExecutionContext(
    request: PreparedJobAnalysisRequest
  ): Promise<JobAnalysisExecutionContext | null> {
    const fingerprint = jobAnalysisInputFingerprintRef.current;
    const jobRequest = jobAnalysisRequestFields();
    const fitRequest = fitAssessmentRequestFields();
    const readiness = await ensureProviderReady(jobRequest);
    if (!request.isCurrent() || fingerprint !== jobAnalysisInputFingerprintRef.current) return null;
    return { fingerprint, jobRequest, fitRequest, readiness };
  }

  function restorePreparedFitAssessment(
    preparedJob: PreparedFitAssessmentJob,
    snapshot?: FitAssessmentSnapshot,
    draft: { url: string; sourceText: string } = {
      url: jobUrl.trim(),
      sourceText: jobRawText.trim() || jobDescription.trim()
    }
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
    const { prepareRunId } = nextPrepareIdentity();
    commitPreparation({
      id: prepareRunId,
      draft,
      preparedJob,
      selectedResume: null
    });
    setLocalPreparedPreview(null);
    setJobAnalysisProgress({ status: "idle" });
    setJobAnalysisProgressVisible(false);
    setJobAnalysisRetrySource(null);
    setFitAssessmentState(restoredFitAssessmentState(runFitAssessment, prepareRunId, snapshot));
  }

  useEffect(() => {
    if (!jobAnalysisAbortRef.current) return;
    // Committing a prepared brief updates the controlled URL/description with
    // this request's own output. That expected transition is not a user edit.
    if (jobAnalysisInputFingerprint === jobAnalysisExpectedFingerprintRef.current) return;
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
      setFitAssessmentState((current) => setFitAssessmentEnabled(current, true));
      return;
    }
    fitAssessmentAbortRef.current?.abort();
    fitAssessmentAbortRef.current = null;
    setFitAssessmentState((current) => setFitAssessmentEnabled(current, false));
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
    request: PreparedJobAnalysisRequest,
    prepareIdentity: { prepareRunId: string; automationToken: string }
  ): Promise<PreparedResumeAndFit | null> {
    const selection = await resolvePreparedResume(localJobText, {
      signal: request.signal,
      isCurrent: request.isCurrent
    });
    if (!request.isCurrent()) return null;
    if (!runFitAssessment) {
      setFitAssessmentState((current) => setFitAssessmentEnabled(current, false));
      return { selection, fitRequest: null, fitRunId: null };
    }
    // Assessment stays available even here: this preparation is real, and the
    // user can open or save a resume without preparing the posting again.
    if (!selection) {
      setFitAssessmentState((current) => failFitAssessmentRun(current, null, {
        resumeLabel: "",
        message: "Fit Assessment needs your own resume. Open or save one, then retry the assessment."
      }));
      return { selection: null, fitRequest: null, fitRunId: null };
    }
    const fitRequest: FitAssessmentRequest = {
      resumeText: selection.text,
      resumeLabel: selection.label,
      candidateContext: candidateContext()
    };
    const fitRunId = nextFitRunId();
    setFitAssessmentState((current) => beginFitAssessmentRun(current, {
      id: fitRunId,
      kind: "prepare",
      resumeLabel: fitRequest.resumeLabel,
      prepareRunId: prepareIdentity.prepareRunId,
      automationToken: prepareIdentity.automationToken
    }));
    return { selection, fitRequest, fitRunId };
  }

  function settlePreparationFit({
    status,
    fitRequest
  }: {
    status: "too-short" | "failed" | "stopped" | "inputs-changed";
    fitRequest?: FitAssessmentRequest | null;
  }) {
    if (!runFitAssessment) return;
    const message = status === "stopped"
      ? "Fit Assessment stopped with Job analysis. Prepare again or retry the assessment."
      : status === "inputs-changed"
        ? "Fit Assessment stopped because the preparation inputs changed. Prepare again or retry the assessment."
        : status === "too-short"
          ? "Fit Assessment stopped because the posting did not contain enough job-relevant text."
          : "Fit Assessment stopped because preparation failed. Prepare again or retry the assessment.";
    setFitAssessmentState((current) => {
      const activeRun = current.activeRun;
      if (!activeRun || activeRun.kind !== "prepare") return current;
      if (fitRequest && activeRun.resumeLabel !== fitRequest.resumeLabel) return current;
      return failFitAssessmentRun(current, activeRun.id, {
        resumeLabel: activeRun.resumeLabel,
        message
      });
    });
  }

  function applyFitAssessmentOutcome({
    runId,
    outcome,
    fitRequest,
    screeningJobText,
    aiRequest,
    executionUsage,
    automationEligible = true,
    unavailableMessage = "Fit Assessment is unavailable. You can continue to Polish or retry the assessment."
  }: {
    runId: string;
    outcome: FitAssessmentResult | null;
    fitRequest: FitAssessmentRequest | null;
    screeningJobText: string;
    aiRequest: AiRequestFields;
    executionUsage?: FitAssessmentExecutionUsage;
    automationEligible?: boolean;
    unavailableMessage?: string;
  }) {
    if (!runFitAssessment) {
      setFitAssessmentState((current) => setFitAssessmentEnabled(current, false));
      return;
    }
    if (!fitRequest) return;
    if (outcome) {
      setFitAssessmentState((current) => {
        const completionState = !automationEligible && current.activeRun?.id === runId
          ? {
              ...current,
              activeRun: { ...current.activeRun, automationToken: undefined }
            }
          : current;
        return completeFitAssessmentRun(completionState, runId, {
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
          )
        });
      });
      return;
    }
    setFitAssessmentState((current) => failFitAssessmentRun(current, runId, {
      resumeLabel: fitRequest.resumeLabel,
      message: unavailableMessage
    }));
  }

  async function evaluateFitAssessment(
    screeningJobText: string,
    fitRequest: FitAssessmentRequest,
    {
      kind = "reassess",
      activeRun,
      aiRequest: capturedAiRequest
    }: {
      kind?: "prepare" | "reassess" | "resume-change";
      activeRun?: { id?: string; prepareRunId?: string; automationToken?: string };
      aiRequest?: AiRequestFields;
    } = {}
  ) {
    if (!runFitAssessment) {
      setFitAssessmentState((current) => setFitAssessmentEnabled(current, false));
      return;
    }
    fitAssessmentAbortRef.current?.abort();
    const controller = new AbortController();
    fitAssessmentAbortRef.current = controller;
    const aiRequest = capturedAiRequest ?? fitAssessmentRequestFields();
    const runId = activeRun?.id ?? nextFitRunId();
    setFitAssessmentState((current) => beginFitAssessmentRun(current, {
      id: runId,
      kind,
      resumeLabel: fitRequest.resumeLabel,
      ...(activeRun?.prepareRunId ? { prepareRunId: activeRun.prepareRunId } : {}),
      ...(activeRun?.automationToken ? { automationToken: activeRun.automationToken } : {})
    }));
    try {
      const readiness = await ensureFitAssessmentProviderReady(aiRequest);
      if (controller.signal.aborted) return;
      if (!readiness.ready) {
        applyFitAssessmentOutcome({
          runId,
          outcome: null,
          fitRequest,
          screeningJobText,
          aiRequest,
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
        runId,
        outcome: outcome.fitAssessment,
        fitRequest,
        screeningJobText,
        aiRequest,
        executionUsage: outcome.usage
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      applyFitAssessmentOutcome({
        runId,
        outcome: null,
        fitRequest,
        screeningJobText,
        aiRequest
      });
    } finally {
      if (fitAssessmentAbortRef.current === controller) fitAssessmentAbortRef.current = null;
    }
  }

  function assessFitForResume(
    selection: Pick<PreparedResumeSelection, "text" | "label">
  ): void {
    const committed = committedPreparationRef.current;
    if (
      !runFitAssessment
      || !committed
      || jobAnalysisBusyRef.current
      || committed.draft.url !== draftInputRef.current.url
      || committed.draft.sourceText !== draftInputRef.current.sourceText
    ) return;
    void evaluateFitAssessment(committed.preparedJob.screeningJobText, {
      resumeText: selection.text,
      resumeLabel: selection.label,
      candidateContext: candidateContext()
    }, {
      kind: "resume-change",
      activeRun: { prepareRunId: committed.id }
    });
  }

  async function reassessFit() {
    const committed = committedPreparationRef.current;
    if (!runFitAssessment || !committed || jobAnalysisBusyRef.current || fitAssessmentState.activeRun) return;
    await dispatchFitAssessment({
      preparedJob: committed.preparedJob,
      currentResume,
      resolvePreparedResume,
      candidateContext,
      onUnavailable: () => setFitAssessmentState((current) => failFitAssessmentRun(current, null, {
        resumeLabel: "",
        message: "Fit Assessment needs your own resume. Open or save one, then retry the assessment."
      })),
      refresh: (screeningJobText, fitRequest) => evaluateFitAssessment(
        screeningJobText,
        fitRequest,
        {
          kind: "reassess",
          activeRun: { prepareRunId: committed.id }
        }
      )
    });
  }

  const currentPrepared = committedPreparation;
  const currentSelection = currentResume();
  const preparationDraftDiverged = Boolean(
    currentPrepared && (
      currentPrepared.draft.url !== jobUrl.trim()
      || currentPrepared.draft.sourceText !== (jobRawText.trim() || jobDescription.trim())
    )
  );
  const completedAssessment = fitAssessmentState.latestCompleted;
  const assessmentBelongsToPreviousPreparation = Boolean(
    preparationDraftDiverged
    || (
      completedAssessment?.prepareRunId
      && currentPrepared
      && completedAssessment.prepareRunId !== currentPrepared.id
    )
  );
  const fitAssessmentChanges = completedAssessment?.provenance && currentPrepared
    ? fitAssessmentProvenanceChanges(
        completedAssessment.provenance,
        currentPrepared.preparedJob.screeningJobText,
        currentSelection,
        candidateContext(),
        fitAssessmentRequestFields()
      )
    : [];
  if (preparationDraftDiverged && !fitAssessmentChanges.includes("job")) {
    fitAssessmentChanges.unshift("job");
  }
  const visibleFitAssessmentState: FitAssessmentState = completedAssessment
    ? {
        ...fitAssessmentState,
        latestCompleted: {
          ...completedAssessment,
          changes: fitAssessmentChanges,
          previousPreparation: assessmentBelongsToPreviousPreparation
        }
      }
    : fitAssessmentState;

  function acknowledgeFitAutomation(token: string) {
    setFitAssessmentState((current) => consumeFitAssessmentAutomationToken(current, token));
  }

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

  function settleSourceReplacementStop(
    choice: "keep-current" | "cancel",
    setStatus: (value: string) => void
  ) {
    const keptCurrent = choice === "keep-current";
    const message = keptCurrent
      ? "Kept the posting attached to the saved record."
      : "Replacement canceled. The saved record was not changed.";
    setJobAnalysisProgress({
      status: "stopped",
      errorHeadline: "Posting replacement paused",
      error: message
    });
    setJobAnalysisProgressVisible(true);
    setStatus(message);
  }

  function clearHandledDuplicateState(): void {
    setJobAnalysisProgress({ status: "idle" });
    setJobAnalysisProgressVisible(false);
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
      error: "Preparation stopped. Completed changes are retained; unfinished Job analysis or Fit Assessment output was not applied."
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
    stopFitAssessmentForDraftChange();
    setJobDescription(value);
    // Fresh draft intake releases the application link, while the committed
    // PreparationRun and its last completed Fit remain available as a clearly
    // previous assessment until the replacement preparation succeeds.
    setImportedJob(null);
    setPipelineAiUsage((prev) => ({ ...prev, "job-analysis": { source: "none" } }));
    setJobRawText("");
    setLocalPreparedPreview(null);
  }

  function handleJobUrlChange(value: string) {
    cancelPreparedResumeResolution();
    stopFitAssessmentForDraftChange();
    setJobUrl(value);
    setImportedJob(null);
    setLocalPreparedPreview(null);
  }

  function stopFitAssessmentForDraftChange() {
    fitAssessmentAbortRef.current?.abort();
    fitAssessmentAbortRef.current = null;
    setFitAssessmentState((current) => current.activeRun
      ? failFitAssessmentRun(current, current.activeRun.id, {
          resumeLabel: current.activeRun.resumeLabel,
          message: "Fit Assessment stopped because the job draft changed. Prepare the current posting before reassessing."
        })
      : current);
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
    execution,
    request
  }: {
    source: PreparedJobAnalysisSource;
    url: string;
    localSourceText: string;
    screeningJobText: string;
    execution: JobAnalysisExecutionContext;
    request: PreparedJobAnalysisRequest;
  }): Promise<PreparedJobAnalysisOutcome> {
    const localExtracted = extractJobPosting(localSourceText, { url: url || undefined });
    const replacementChoice = await confirmPreparedSourceReplacement({
      url,
      sourceText: localSourceText,
      tracking: localExtracted.tracking
    });
    if (!request.isCurrent()) return { status: "stale" };
    if (replacementChoice !== "continue") {
      return { status: "source-replacement-stopped", choice: replacementChoice };
    }
    const duplicateBefore = await confirmDuplicateBeforeJobAnalysis(
      url,
      localSourceText,
      localExtracted.tracking
    );
    if (!request.isCurrent()) return { status: "stale" };
    if (!duplicateBefore.proceed) {
      if (duplicateBefore.handled) return { status: "duplicate-handled" };
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

    const jobAnalysisAiRequest = execution.jobRequest;
    const fitAssessmentAiRequest = execution.fitRequest;
    // Rank against the compact local brief, while the provider and Fit
    // provenance retain the complete captured posting.
    const localJobText = localExtracted.tailoringText;
    setLocalPreparedPreview(importedJobSnapshot(url, localJobText, localExtracted, screeningJobText));
    const prepareIdentity = nextPrepareIdentity();
    const preparedResume = await prepareResumeAndFitAssessment(
      localJobText,
      request,
      prepareIdentity
    );
    if (!request.isCurrent() || !preparedResume) return { status: "stale" };
    const { selection, fitRequest, fitRunId } = preparedResume;
    // Preserve Prepare's one-call fast path only when the two independently
    // configured stages resolve to the exact same provider request. A distinct
    // Fit Assessment config must never be silently replaced by Job analysis's.
    const combineFitAssessment = Boolean(fitRequest)
      && aiRequestFieldsMatch(jobAnalysisAiRequest, fitAssessmentAiRequest);

    const result = execution.readiness.ready
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
          failure: classifyFailure(new ApiError(execution.readiness.message, 503))
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
    // The controlled source fields below are this request's committed output,
    // not a concurrent user edit. Rebase the stale-input guard before React
    // renders those values so the awaited Prepare-owned Fit remains attached.
    request.expectInputFingerprint(workflowInputFingerprint({
      jobUrl: source === "extension" || source === "retry" ? url : jobUrl,
      jobDescription: relevant,
      runFitAssessment,
      jobAnalysisRequest: execution.jobRequest,
      fitAssessmentRequest: runFitAssessment ? execution.fitRequest : null
    }));
    commitPreparation({
      id: prepareIdentity.prepareRunId,
      draft: { url: url.trim(), sourceText: screeningJobText.trim() },
      preparedJob: { localJobText, screeningJobText },
      selectedResume: selection
    });
    if (combineFitAssessment) {
      applyFitAssessmentOutcome({
        runId: fitRunId!,
        outcome: result.fitAssessment,
        fitRequest,
        screeningJobText,
        aiRequest: fitAssessmentAiRequest,
        executionUsage: result.usage,
        automationEligible: duplicateAfter.proceed,
        unavailableMessage: duplicateAfter.proceed
          ? undefined
          : "Fit Assessment completed after duplicate review stopped Prepare."
      });
    } else if (fitRequest) {
      if (duplicateAfter.proceed) {
        // The first separately configured assessment is still part of this
        // Prepare transaction. Await its automation decision before Apply can
        // treat preparation as settled.
        await evaluateFitAssessment(screeningJobText, fitRequest, {
          kind: "prepare",
          activeRun: {
            id: fitRunId!,
            prepareRunId: prepareIdentity.prepareRunId,
            automationToken: prepareIdentity.automationToken
          },
          aiRequest: fitAssessmentAiRequest
        });
      } else {
        applyFitAssessmentOutcome({
          runId: fitRunId!,
          outcome: null,
          fitRequest,
          screeningJobText,
          aiRequest: fitAssessmentAiRequest,
          unavailableMessage: "Fit Assessment did not run because duplicate review stopped Prepare."
        });
      }
    }

    // A Stop or input change can happen while the separately configured Fit
    // request above is awaited. Do not let the outer intake handler publish a
    // terminal "done" state after that preparation was explicitly cancelled.
    if (request.signal.aborted) return { status: "stale" };

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
    const releaseJobAnalysisRun = tryClaimJobAnalysisRun();
    if (!releaseJobAnalysisRun) return;
    const request = startJobAnalysisRequest();
    setIsExtractingLink(true);
    setJobAnalysisRetrySource("link");
    setJobAnalysisProgress({ status: "running" });
    setJobAnalysisProgressVisible(true);
    setLinkStatus("Fetching the posting…");
    try {
      const execution = await createJobAnalysisExecutionContext(request);
      if (!execution) {
        setLinkStatus("Job inputs changed while AI setup was being checked. Prepare the current posting again.");
        return;
      }
      if (!execution.readiness.ready) setJobAnalysisRetrySource("link");
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
        execution,
        request
      });
      if (outcome.status === "stale") return;
      if (outcome.status === "source-replacement-stopped") {
        settleSourceReplacementStop(outcome.choice, setLinkStatus);
        return;
      }
      if (outcome.status === "duplicate-handled") {
        clearHandledDuplicateState();
        return;
      }
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
      const execution = await createJobAnalysisExecutionContext(request);
      if (!execution) {
        setLinkStatus("Job inputs changed while AI setup was being checked. Prepare the current posting again.");
        return;
      }
      if (!execution.readiness.ready) setJobAnalysisRetrySource("paste");
      const trimmedUrl = jobUrl.trim();
      const outcome = await runPreparedJobAnalysis({
        source: "paste",
        url: trimmedUrl,
        localSourceText: cleaned,
        screeningJobText: cleaned,
        execution,
        request
      });
      if (outcome.status === "stale") return;
      if (outcome.status === "source-replacement-stopped") {
        settleSourceReplacementStop(outcome.choice, setLinkStatus);
        return;
      }
      if (outcome.status === "duplicate-handled") {
        clearHandledDuplicateState();
        return;
      }
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
    if (runFitAssessment) {
      setFitAssessmentState((current) => failFitAssessmentRun(current, null, {
        resumeLabel: "",
        message: "Fit Assessment did not run because duplicate review stopped Prepare."
      }));
    }
  }

  // Retry an extension-import analysis by re-running provider-backed AI job analysis
  // against its stored raw text. The extension import is event-driven, so this
  // gives its card a working retry after a provider or request failure.
  async function retryImportedJobAnalysis() {
    const payload = jobAnalysisImportRef.current;
    if (!payload) return;
    const releaseJobAnalysisRun = tryClaimJobAnalysisRun();
    if (!releaseJobAnalysisRun) return;
    const request = startJobAnalysisRequest();
    setIsExtractingLink(true);
    setJobAnalysisRetrySource("import");
    setJobAnalysisProgress({ status: "running" });
    setJobAnalysisProgressVisible(true);
    try {
      const execution = await createJobAnalysisExecutionContext(request);
      if (!execution) {
        setPolishStatus("Preparation settings changed while provider readiness was checked. Retry the current posting.");
        return;
      }
      if (!execution.readiness.ready) setJobAnalysisRetrySource("import");
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
        execution,
        request
      });
      if (outcome.status === "stale") return;
      if (outcome.status === "source-replacement-stopped") {
        settleSourceReplacementStop(outcome.choice, setPolishStatus);
        return;
      }
      if (outcome.status === "duplicate-handled") {
        clearHandledDuplicateState();
        return;
      }
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
      const releaseJobAnalysisRun = await waitAndClaimJobAnalysisRun();
      const request = startJobAnalysisRequest();
      setIsExtractingLink(true);
      try {
        const execution = await createJobAnalysisExecutionContext(request);
        if (!execution) {
          setPolishStatus("Preparation settings changed while provider readiness was checked. Retry the imported posting.");
          return;
        }
        const outcome = await runPreparedJobAnalysis({
          source: "extension",
          url: trimmedUrl,
          localSourceText: text.trim(),
          screeningJobText: text,
          execution,
          request
        });
        if (outcome.status === "stale") return;
        if (outcome.status === "source-replacement-stopped") {
          settleSourceReplacementStop(outcome.choice, setPolishStatus);
          return;
        }
        if (outcome.status === "duplicate-handled") {
          clearHandledDuplicateState();
          return;
        }
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
    currentPreparationId: currentPrepared?.id ?? "",
    isExtractingLink,
    extensionImportPhase,
    jobAnalysisProgress,
    jobAnalysisProgressVisible,
    dismissJobAnalysisProgress,
    stopJobAnalysis,
    jobAnalysisRetry,
    fitAssessmentState: visibleFitAssessmentState,
    fitAssessmentRequestActive: fitAssessmentState.activeRun !== null,
    preparationAutomationPending: Boolean(fitAssessmentState.latestCompleted?.automationToken),
    acknowledgeFitAutomation,
    restorePreparedFitAssessment,
    reassessFit,
    // Assessment is offered whenever a prepared posting exists, even when no
    // resume resolved and the unavailable state therefore has no label.
    canAssessFit: fitAssessmentCanRun(
      runFitAssessment,
      committedPreparation?.preparedJob ?? null
    ) && !jobAnalysisBusyRef.current && !preparationDraftDiverged && fitAssessmentState.activeRun === null,
    preparationDraftDiverged,
    assessFitForResume,
    localPreparedPreview,
    handleManualJobDescriptionChange,
    handleJobUrlChange,
    handleExtractFromLink,
    handleAnalyzePaste
  };
}
