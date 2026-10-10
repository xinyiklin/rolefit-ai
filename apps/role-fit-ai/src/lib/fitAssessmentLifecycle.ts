import {
  FIT_ASSESSMENT_PROMPT_VERSION,
  normalizeFitAssessmentInput,
  type FitAssessmentActiveRun,
  type FitAssessmentCompleted,
  type FitAssessmentInputChange,
  type FitAssessmentProvenance,
  type FitAssessmentResult,
  type FitAssessmentSnapshot,
  type FitAssessmentState
} from "../../shared/fitAssessmentContract.ts";
import {
  isPolishFitExcerpt,
  POLISH_FIT_FINDINGS_ITEM_LIMIT,
  type PolishFitFindings
} from "../../shared/polishFitFindings.ts";
import type { FitAssessmentRequest } from "./aiJobAnalysis";
import type { AiRequestFields } from "./aiRequest.ts";
import { workflowInputFingerprint } from "./aiWorkflow";
import { contentFingerprint } from "./contentFingerprint.ts";
import type { PreparedResumeSelection } from "./preparedResume.ts";

export type PreparedFitAssessmentJob = {
  localJobText: string;
  screeningJobText: string;
};

export type FitAssessmentPersistenceDecision =
  | { action: "set"; snapshot: FitAssessmentSnapshot }
  | { action: "preserve" }
  | { action: "clear" };

export function fitAssessmentMayTriggerAutoPolish(
  state: FitAssessmentState
): FitAssessmentCompleted & { provenance: FitAssessmentProvenance; automationToken: string } | null {
  const completed = state.latestCompleted;
  return completed?.snapshot.result.status !== "INSUFFICIENT_JOB_INFORMATION"
    && completed?.origin === "current"
    && !completed.previousPreparation
    && completed.changes.length === 0
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
  const completed = state.latestCompleted;
  return completed && !completed.previousPreparation ? completed.snapshot : null;
}

// The assessment the Prepare rail presents as current: this preparation, live
// origin, unchanged inputs, and no re-run in flight or failed since.
export function fitAssessmentCurrentResult(
  state: FitAssessmentState
): Extract<FitAssessmentResult, { status: "ASSESSED" }> | null {
  const completed = state.latestCompleted;
  const result = completed?.snapshot.result;
  return completed
    && completed.origin === "current"
    && !completed.previousPreparation
    && completed.changes.length === 0
    && !state.activeRun
    && !state.lastError
    && result?.status === "ASSESSED"
    ? result
    : null;
}

// What Resume and Cover Polish are told about Fit: posting excerpts from an
// assessment of this same posting. A changed resume or Background still sends
// them, labelled earlier; a saved assessment cannot confirm its inputs, so it is
// labelled the same way. Excerpts Polish would refuse are left out, never sent.
export function fitFindingsForPolish(state: FitAssessmentState): PolishFitFindings | null {
  const completed = state.latestCompleted;
  const result = completed?.snapshot.result;
  if (!completed || completed.previousPreparation || completed.changes.includes("job") || result?.status !== "ASSESSED") return null;
  const matches = result.matches.filter((match) => isPolishFitExcerpt(match.jobExcerpt)).slice(0, POLISH_FIT_FINDINGS_ITEM_LIMIT)
    .map(({ jobExcerpt, relationship }) => ({ jobExcerpt, ...(relationship ? { relationship } : {}) }));
  const gaps = result.gaps.filter(isPolishFitExcerpt).slice(0, POLISH_FIT_FINDINGS_ITEM_LIMIT)
    .map((jobExcerpt, index) => ({ id: `gap-${index + 1}`, jobExcerpt }));
  if (!matches.length && !gaps.length) return null;
  const earlierVersion = completed.origin === "saved"
    || completed.changes.includes("resume")
    || completed.changes.includes("candidate-context");
  return { earlierVersion, matches, gaps };
}

export function fitAssessmentPersistenceDecision(
  state: FitAssessmentState
): FitAssessmentPersistenceDecision {
  const completed = state.latestCompleted;
  if (!completed) return { action: "preserve" };
  return completed.previousPreparation
    ? { action: "clear" }
    : { action: "set", snapshot: completed.snapshot };
}

export function emptyFitAssessmentState(
  message = "Prepare a job to run Fit Assessment."
): FitAssessmentState {
  return {
    latestCompleted: null,
    activeRun: null,
    lastError: { resumeLabel: "", message }
  };
}

export function beginFitAssessmentRun(
  state: FitAssessmentState,
  activeRun: FitAssessmentActiveRun
): FitAssessmentState {
  return {
    ...state,
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

export function consumeFitAssessmentAutomationToken(
  state: FitAssessmentState,
  token: string
): FitAssessmentState {
  if (state.latestCompleted?.automationToken !== token) return state;
  const { automationToken: _automationToken, ...completed } = state.latestCompleted;
  return { ...state, latestCompleted: completed };
}

export function restoredFitAssessmentState(
  prepareRunId: string,
  snapshot?: FitAssessmentSnapshot
): FitAssessmentState {
  return {
    latestCompleted: snapshot
      ? {
          snapshot,
          origin: "saved",
          changes: [],
          previousPreparation: false,
          prepareRunId
        }
      : null,
    activeRun: null,
    lastError: null
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
