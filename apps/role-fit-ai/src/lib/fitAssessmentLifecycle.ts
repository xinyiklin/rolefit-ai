import {
  FIT_ASSESSMENT_PROMPT_VERSION,
  normalizeFitAssessmentInput,
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
): state is Extract<FitAssessmentState, { status: "ready" }> {
  return state.status === "ready" && state.autoPolishEligible;
}

export function fitAssessmentLatestSnapshot(
  state: FitAssessmentState
): FitAssessmentSnapshot | null {
  return state.status === "ready" || state.status === "saved" || state.status === "stale"
    ? state.snapshot
    : null;
}

export function restoredFitAssessmentState(
  runFitAssessment: boolean,
  snapshot?: FitAssessmentSnapshot
): FitAssessmentState {
  if (!runFitAssessment) return { status: "disabled" };
  if (snapshot) return { status: "saved", snapshot };
  return {
    status: "unavailable",
    resumeLabel: "",
    message: "No Fit Assessment is saved for this preparation. Run it against the restored resume."
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
