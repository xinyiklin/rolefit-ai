export type ApplicationUnloadGuardState = {
  resumeDocumentDirty: boolean;
  coverLetterRecoveryDirty: boolean;
  isGeneratingCover: boolean;
  isPolishStarting: boolean;
  isPolishing: boolean;
  jobAnalysisRunning: boolean;
  fitAssessmentRequestActive: boolean;
  preparationAutomationPending: boolean;
  pendingApplicationWrites: number;
  isApplying: boolean;
};

// Apply owns both the tracker write and the later strict document uploads.
// Keeping that phase in this one predicate prevents clean editors from making
// the ordinary fetch requests interruptible after the tracker has committed.
export function applicationUnloadGuardActive(
  state: ApplicationUnloadGuardState
): boolean {
  return (
    state.resumeDocumentDirty ||
    state.coverLetterRecoveryDirty ||
    state.isGeneratingCover ||
    state.isPolishStarting ||
    state.isPolishing ||
    state.jobAnalysisRunning ||
    state.fitAssessmentRequestActive ||
    state.preparationAutomationPending ||
    state.pendingApplicationWrites > 0 ||
    state.isApplying
  );
}
