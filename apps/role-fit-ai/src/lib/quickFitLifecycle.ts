import type { QuickFitProvenance } from "../../shared/quickFitContract.ts";
import { quickFitRequirementCandidatesFromPreparedJob } from "../../shared/quickFitContract.ts";
import type { InitialFitRequest } from "./aiJobAnalysis";
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
    resumeText: request.resumeText.trim(),
    resumeLabel: request.resumeLabel.trim(),
    candidateContext: (request.candidateContext ?? "").trim(),
    requiredRequirements: (request.requiredRequirements ?? []).map((requirement) => ({
      requirementId: requirement.requirementId.trim(),
      sourceRequirement: requirement.sourceRequirement.trim(),
      importance: requirement.importance,
      kind: requirement.kind
    }))
  };
}

// This is the exact semantic Initial Fit payload: the complete screening text
// plus every selected-resume field sent alongside it. The prepared-brief
// fingerprint below has a different job: it anchors what the user currently
// sees after a combined Prepare response settles.
export function quickFitRequestFingerprint(
  screeningJobText: string,
  request: InitialFitRequest
): string {
  return workflowInputFingerprint({
    jobText: screeningJobText.trim(),
    ...normalizedRequest(request)
  });
}

export function createQuickFitProvenance(
  screeningJobText: string,
  displayedPreparedJobText: string,
  request: InitialFitRequest
): QuickFitProvenance {
  return {
    resumeFingerprint: contentFingerprint(request.resumeText),
    candidateContextFingerprint: contentFingerprint(request.candidateContext ?? ""),
    preparedJobFingerprint: contentFingerprint(displayedPreparedJobText),
    inputFingerprint: quickFitRequestFingerprint(screeningJobText, request)
  };
}

export function quickFitProvenanceIsStale(
  provenance: QuickFitProvenance,
  displayedPreparedJobText: string,
  currentResume: Pick<PreparedResumeSelection, "text"> | null,
  candidateContext: string
): boolean {
  if (!currentResume) return true;
  return (
    provenance.preparedJobFingerprint !== contentFingerprint(displayedPreparedJobText)
    || provenance.resumeFingerprint !== contentFingerprint(currentResume.text)
    || provenance.candidateContextFingerprint !== contentFingerprint(candidateContext)
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
      candidateContext: candidateContext(),
      requiredRequirements: quickFitRequirementCandidatesFromPreparedJob(currentPreparedJob)
    },
    currentPreparedJob
  );
  return true;
}
