import {
  FIT_ASSESSMENT_PROMPT_VERSION,
  normalizeFitAssessmentInput,
  type FitAssessmentActiveRun,
  type FitAssessmentCompleted,
  type FitAssessmentInputChange,
  type FitAssessmentProvenance,
  type FitAssessmentSnapshot,
  type FitAssessmentState
} from "../../shared/fitAssessmentContract.ts";
import type { FitAssessmentRequest } from "./aiJobAnalysis";
import type { AiRequestFields } from "./aiRequest.ts";
import { workflowInputFingerprint } from "./aiWorkflow";
import { contentFingerprint } from "./contentFingerprint.ts";
import type { PreparedResumeSelection } from "./preparedResume.ts";

export type PreparedFitAssessmentJob = {
  localJobText: string;
  screeningJobText: string;
};

export function fitAssessmentCanRun(
  runFitAssessment: boolean,
  preparedJob: PreparedFitAssessmentJob | null
): boolean {
  return runFitAssessment && preparedJob !== null;
}

export function fitAssessmentMayTriggerAutoPolish(
  state: FitAssessmentState
): FitAssessmentCompleted & { provenance: FitAssessmentProvenance; automationToken: string } | null {
  const completed = state.latestCompleted;
  return completed?.origin === "current"
    && completed.provenance
    && completed.automationToken
    ? completed as FitAssessmentCompleted & {
        provenance: FitAssessmentProvenance;
        automationToken: string;
      }
    : null;
}

export function fitAssessmentLatestSnapshot(
  state: FitAssessmentState
): FitAssessmentSnapshot | null {
  return state.latestCompleted?.snapshot ?? null;
}

export function emptyFitAssessmentState(
  enabled: boolean,
  message = "Prepare a job to run Fit Assessment."
): FitAssessmentState {
  return {
    enabled,
    latestCompleted: null,
    activeRun: null,
    lastError: enabled ? { resumeLabel: "", message } : null
  };
}

export function beginFitAssessmentRun(
  state: FitAssessmentState,
  activeRun: FitAssessmentActiveRun
): FitAssessmentState {
  return {
    ...state,
    enabled: true,
    activeRun,
    lastError: null
  };
}

export function completeFitAssessmentRun(
  state: FitAssessmentState,
  runId: string,
  completed: Pick<FitAssessmentCompleted, "snapshot" | "provenance">
): FitAssessmentState {
  if (state.activeRun?.id !== runId) return state;
  return {
    ...state,
    latestCompleted: {
      ...completed,
      origin: "current",
      changes: [],
      previousPreparation: false,
      ...(state.activeRun.prepareRunId ? { prepareRunId: state.activeRun.prepareRunId } : {}),
      ...(state.activeRun.automationToken ? { automationToken: state.activeRun.automationToken } : {})
    },
    activeRun: null,
    lastError: null
  };
}

export function failFitAssessmentRun(
  state: FitAssessmentState,
  runId: string | null,
  error: { resumeLabel: string; message: string }
): FitAssessmentState {
  if (runId && state.activeRun?.id !== runId) return state;
  return {
    ...state,
    activeRun: runId ? null : state.activeRun,
    lastError: error
  };
}

export function setFitAssessmentEnabled(
  state: FitAssessmentState,
  enabled: boolean,
  message = "Prepare the current posting to run Fit Assessment."
): FitAssessmentState {
  return {
    ...state,
    enabled,
    activeRun: null,
    lastError: enabled && !state.latestCompleted
      ? { resumeLabel: "", message }
      : null
  };
}

export function consumeFitAssessmentAutomationToken(
  state: FitAssessmentState,
  token: string
): FitAssessmentState {
  if (state.latestCompleted?.automationToken !== token) return state;
  const { automationToken: _automationToken, ...completed } = state.latestCompleted;
  return { ...state, latestCompleted: completed };
}

export function restoredFitAssessmentState(
  runFitAssessment: boolean,
  snapshot?: FitAssessmentSnapshot
): FitAssessmentState {
  return {
    enabled: runFitAssessment,
    latestCompleted: snapshot
      ? { snapshot, origin: "saved", changes: [], previousPreparation: false }
      : null,
    activeRun: null,
    lastError: runFitAssessment && !snapshot
      ? {
          resumeLabel: "",
          message: "No Fit Assessment is saved for this preparation. Run it against the restored resume."
        }
      : null
  };
}

function normalizedRequest(request: FitAssessmentRequest) {
  return {
    resumeText: normalizeFitAssessmentInput(request.resumeText),
    candidateContext: normalizeFitAssessmentInput(request.candidateContext)
  };
}

export function fitAssessmentRequestIdentityFingerprint(
  aiRequest: Partial<AiRequestFields>
): string {
  return workflowInputFingerprint({
    provider: String(aiRequest.provider ?? "").trim(),
    model: String(aiRequest.model ?? "").trim(),
    reasoningEffort: String(aiRequest.reasoningEffort ?? "").trim(),
    promptVersion: FIT_ASSESSMENT_PROMPT_VERSION
  });
}

// This is the exact semantic Fit Assessment payload. Friendly labels are omitted:
// two files can share one, and renaming a file does not change the evidence.
export function fitAssessmentRequestFingerprint(
  screeningJobText: string,
  request: FitAssessmentRequest,
  aiRequest: Partial<AiRequestFields>
): string {
  return workflowInputFingerprint({
    jobText: normalizeFitAssessmentInput(screeningJobText),
    ...normalizedRequest(request),
    requestIdentity: fitAssessmentRequestIdentityFingerprint(aiRequest)
  });
}

export function createFitAssessmentProvenance(
  screeningJobText: string,
  request: FitAssessmentRequest,
  aiRequest: Partial<AiRequestFields>
): FitAssessmentProvenance {
  const requestFingerprint = fitAssessmentRequestFingerprint(screeningJobText, request, aiRequest);
  return {
    screeningJobFingerprint: contentFingerprint(normalizeFitAssessmentInput(screeningJobText)),
    resumeFingerprint: contentFingerprint(normalizeFitAssessmentInput(request.resumeText)),
    candidateContextFingerprint: contentFingerprint(normalizeFitAssessmentInput(request.candidateContext)),
    requestIdentityFingerprint: fitAssessmentRequestIdentityFingerprint(aiRequest),
    inputFingerprint: requestFingerprint
  };
}

export function fitAssessmentProvenanceIsStale(
  provenance: FitAssessmentProvenance,
  screeningJobText: string,
  currentResume: Pick<PreparedResumeSelection, "text"> | null,
  candidateContext: string,
  aiRequest: Partial<AiRequestFields>
): boolean {
  return fitAssessmentProvenanceChanges(
    provenance,
    screeningJobText,
    currentResume,
    candidateContext,
    aiRequest
  ).length > 0;
}

export function fitAssessmentProvenanceChanges(
  provenance: FitAssessmentProvenance,
  screeningJobText: string,
  currentResume: Pick<PreparedResumeSelection, "text"> | null,
  candidateContext: string,
  aiRequest: Partial<AiRequestFields>
): FitAssessmentInputChange[] {
  const changes: FitAssessmentInputChange[] = [];
  if (
    provenance.screeningJobFingerprint
    !== contentFingerprint(normalizeFitAssessmentInput(screeningJobText))
  ) changes.push("job");
  if (
    !currentResume
    || provenance.resumeFingerprint
      !== contentFingerprint(normalizeFitAssessmentInput(currentResume.text))
  ) changes.push("resume");
  if (
    provenance.candidateContextFingerprint
    !== contentFingerprint(normalizeFitAssessmentInput(candidateContext))
  ) changes.push("candidate-context");
  if (
    provenance.requestIdentityFingerprint
    !== fitAssessmentRequestIdentityFingerprint(aiRequest)
  ) changes.push("settings");
  return changes;
}

export async function dispatchFitAssessment({
  preparedJob,
  currentResume,
  resolvePreparedResume,
  candidateContext,
  onUnavailable,
  refresh
}: {
  preparedJob: PreparedFitAssessmentJob;
  currentResume: () => Pick<PreparedResumeSelection, "text" | "label"> | null;
  resolvePreparedResume: (jobText: string) => Promise<PreparedResumeSelection | null>;
  candidateContext: () => string;
  onUnavailable: () => void;
  refresh: (screeningJobText: string, request: FitAssessmentRequest) => Promise<void>;
}): Promise<boolean> {
  const selection = currentResume() ?? await resolvePreparedResume(preparedJob.localJobText);
  if (!selection) {
    onUnavailable();
    return false;
  }
  await refresh(
    preparedJob.screeningJobText,
    {
      resumeText: selection.text,
      resumeLabel: selection.label,
      candidateContext: candidateContext()
    }
  );
  return true;
}
