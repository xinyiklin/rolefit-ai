export type ApplicationUnloadGuardState = {
  resumeNeedsUnloadGuard: boolean;
  coverLetterNeedsUnloadGuard: boolean;
  isGeneratingCover: boolean;
  isPolishStarting: boolean;
  isPolishing: boolean;
  jobAnalysisRunning: boolean;
  fitAssessmentRequestActive: boolean;
  preparationAutomationPending: boolean;
  pendingApplicationWrites: number;
  applicationSavePending: boolean;
  isSkipping: boolean;
};

export type ApplicationPersistenceReceipt = {
  applicationId: string;
  resume: ApplicationDocumentPersistenceReceipt;
  coverLetter: ApplicationDocumentPersistenceReceipt;
};

type ApplicationDocumentPersistenceReceipt = {
  version: string;
  outcome: "saved" | "excluded" | "failed";
};

type ApplicationDocumentUnloadState = {
  kind: "resume" | "coverLetter";
  dirty: boolean;
  currentVersion: string;
  recoveryDraftSaved: boolean;
  applicationId: string | null;
  receipt: ApplicationPersistenceReceipt | null;
};

// Excluded documents rely on recovery; included documents rely on their exact
// saved application version.
export function applicationDocumentNeedsUnloadGuard(
  state: ApplicationDocumentUnloadState
): boolean {
  if (!state.dirty) return false;
  if (!state.receipt || state.receipt.applicationId !== state.applicationId) return true;
  const documentReceipt = state.receipt[state.kind];
  if (documentReceipt.outcome === "excluded") return !state.recoveryDraftSaved;
  if (documentReceipt.outcome === "failed") return true;
  return documentReceipt.version !== state.currentVersion;
}

export function applicationPersistenceReceiptAfterDocumentSave(
  receipt: ApplicationPersistenceReceipt | null,
  kind: "resume" | "coverLetter",
  applicationId: string,
  version: string
): ApplicationPersistenceReceipt | null {
  if (!receipt || receipt.applicationId !== applicationId) return receipt;
  return {
    ...receipt,
    [kind]: { version, outcome: "saved" }
  };
}

// Guard tracker and included-source writes even when both editors are clean.
export function applicationUnloadGuardActive(
  state: ApplicationUnloadGuardState
): boolean {
  return (
    state.resumeNeedsUnloadGuard ||
    state.coverLetterNeedsUnloadGuard ||
    state.isGeneratingCover ||
    state.isPolishStarting ||
    state.isPolishing ||
    state.jobAnalysisRunning ||
    state.fitAssessmentRequestActive ||
    state.preparationAutomationPending ||
    state.pendingApplicationWrites > 0 ||
    state.applicationSavePending ||
    state.isSkipping
  );
}
