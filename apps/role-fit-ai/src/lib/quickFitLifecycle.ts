import {
  QUICK_FIT_PROMPT_VERSION,
  normalizeQuickFitInput,
  type QuickFitProvenance
} from "../../shared/quickFitContract.ts";
import type { InitialFitRequest } from "./aiJobAnalysis";
import type { AiRequestFields } from "./aiRequest.ts";
import { workflowInputFingerprint } from "./aiWorkflow";
import { contentFingerprint } from "./contentFingerprint.ts";
import type { PreparedResumeSelection } from "./preparedResume.ts";

export type PreparedQuickFitJob = {
  localJobText: string;
  fitJobText: string;
};

export function quickFitRetryIsAvailable(
  runInitialFit: boolean,
  preparedJob: PreparedQuickFitJob | null
): boolean {
  return runInitialFit && preparedJob !== null;
}

function normalizedRequest(request: InitialFitRequest) {
  return {
    resumeText: normalizeQuickFitInput(request.resumeText),
    candidateContext: normalizeQuickFitInput(request.candidateContext)
  };
}

export function quickFitRequestIdentityFingerprint(
  aiRequest: Partial<AiRequestFields>
): string {
  return workflowInputFingerprint({
    provider: String(aiRequest.provider ?? "").trim(),
    model: String(aiRequest.model ?? "").trim(),
    reasoningEffort: String(aiRequest.reasoningEffort ?? "").trim(),
    promptVersion: QUICK_FIT_PROMPT_VERSION
  });
}

// This is the exact semantic Initial Fit payload. Friendly labels are omitted:
// two files can share one, and renaming a file does not change the evidence.
export function quickFitRequestFingerprint(
  screeningJobText: string,
  request: InitialFitRequest,
  aiRequest: Partial<AiRequestFields>
): string {
  return workflowInputFingerprint({
    jobText: normalizeQuickFitInput(screeningJobText),
    ...normalizedRequest(request),
    requestIdentity: quickFitRequestIdentityFingerprint(aiRequest)
  });
}

export function createQuickFitProvenance(
  screeningJobText: string,
  displayedPreparedJobText: string,
  request: InitialFitRequest,
  aiRequest: Partial<AiRequestFields>
): QuickFitProvenance {
  const requestFingerprint = quickFitRequestFingerprint(screeningJobText, request, aiRequest);
  return {
    resumeFingerprint: contentFingerprint(normalizeQuickFitInput(request.resumeText)),
    candidateContextFingerprint: contentFingerprint(normalizeQuickFitInput(request.candidateContext)),
    preparedJobFingerprint: contentFingerprint(normalizeQuickFitInput(displayedPreparedJobText)),
    requestIdentityFingerprint: quickFitRequestIdentityFingerprint(aiRequest),
    inputFingerprint: workflowInputFingerprint({
      requestFingerprint,
      preparedJobText: normalizeQuickFitInput(displayedPreparedJobText)
    })
  };
}

export function quickFitProvenanceIsStale(
  provenance: QuickFitProvenance,
  displayedPreparedJobText: string,
  currentResume: Pick<PreparedResumeSelection, "text"> | null,
  candidateContext: string,
  aiRequest: Partial<AiRequestFields>
): boolean {
  if (!currentResume) return true;
  return (
    provenance.preparedJobFingerprint !== contentFingerprint(normalizeQuickFitInput(displayedPreparedJobText))
    || provenance.resumeFingerprint !== contentFingerprint(normalizeQuickFitInput(currentResume.text))
    || provenance.candidateContextFingerprint !== contentFingerprint(normalizeQuickFitInput(candidateContext))
    || provenance.requestIdentityFingerprint !== quickFitRequestIdentityFingerprint(aiRequest)
  );
}

export async function dispatchQuickFitRetry({
  preparedJob,
  displayedPreparedJobText,
  currentResume,
  resolvePreparedResume,
  candidateContext,
  onUnavailable,
  refresh
}: {
  preparedJob: PreparedQuickFitJob;
  displayedPreparedJobText: string;
  currentResume: () => Pick<PreparedResumeSelection, "text" | "label"> | null;
  resolvePreparedResume: (jobText: string) => Promise<PreparedResumeSelection | null>;
  candidateContext: () => string;
  onUnavailable: () => void;
  refresh: (
    screeningJobText: string,
    request: InitialFitRequest,
    displayedPreparedJobText: string
  ) => Promise<void>;
}): Promise<boolean> {
  const currentPreparedJob = displayedPreparedJobText.trim() || preparedJob.localJobText;
  const selection = currentResume() ?? await resolvePreparedResume(currentPreparedJob);
  if (!selection) {
    onUnavailable();
    return false;
  }
  await refresh(
    currentPreparedJob,
    {
      resumeText: selection.text,
      resumeLabel: selection.label,
      candidateContext: candidateContext()
    },
    currentPreparedJob
  );
  return true;
}
