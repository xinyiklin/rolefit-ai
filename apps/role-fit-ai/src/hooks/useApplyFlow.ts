/** Owns Apply confirmation, tracker commit, document snapshots, and optional PDF export. */
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { makeApplicationRecord, type Application } from "./useApplications";
import type { DuplicateResolution } from "./useDuplicateGuard";
import type { ExtractedJobTracking } from "../lib/jobExtract";
import type { StageAiUsage } from "../lib/aiUsage";
import type { PolishedResume } from "../resumeEngine";
import type { OutputTab } from "../sections/shared";
import { resumeUsedForApplication } from "../lib/applicationDocuments";
import type { DocumentUpload } from "../lib/applicationDocumentRequests";
import { runApplyPdfExports } from "../lib/applyPdfExports";
import type { FitAssessmentPersistenceDecision } from "../lib/fitAssessmentLifecycle.ts";
import {
  preparationCommitIdentity,
  preparationPrimaryAction,
  type PreparationPrimaryAction,
  type PreparationSession
} from "../lib/preparationSession.ts";
import { appliedApplicationForSession } from "../lib/preparationApplication.ts";
import { preparedApplicationRecord } from "../lib/preparedApplicationRecord.ts";
import type { ApplicationPersistenceReceipt } from "../lib/applicationUnloadGuard.ts";
import {
  statusDetail,
  type ApplicationActionStatus
} from "../lib/applicationActionStatus.ts";

// Which of the offered PDFs the user kept checked in the download dialog, and
// the base name (extension excluded) each one carries. Owned here with the rest
// of the Apply contract; the dialog imports both. The dialog seeds the cover
// letter's name from the resume's so the pair matches, then lets the user edit
// either — so by the time they arrive here each name is already final.
export type ApplyDownloadPicks = { resume: boolean; coverLetter: boolean };
export type ApplyDownloadNames = { resume: string; coverLetter: string };

type UseApplyFlowArgs = {
  canApply: boolean;
  applyBlocker: string;
  includeResume: boolean;
  includeCoverLetter: boolean;
  jobUrl: string;
  preparedJobDescription: string;
  jobRawText: string;
  result: PolishedResume | null;
  currentResumeText: string;
  fitAssessmentPersistence: FitAssessmentPersistenceDecision;
  pipelineAiUsage: Record<string, StageAiUsage>;
  preparationSession: PreparationSession;
  currentPreparationId: string;
  getCurrentPreparationId: () => string;
  getPreparationGeneration: () => number;
  getApplication: (id: string) => Application | undefined;
  refreshApplications: () => Promise<boolean>;
  createApplication: (app: Application) => Promise<boolean>;
  updateApplicationById: (app: Application) => Promise<boolean>;
  linkPostingRecords: (applicationIds: string[], groupId?: string) => Promise<string | null>;
  markPostingRecordsUnrelated: (applicationIds: string[]) => Promise<boolean>;
  saveApplicationDocument: (
    id: string,
    kind: "resume" | "cover",
    upload: DocumentUpload
  ) => Promise<{ ok: boolean; error?: string }>;
  // Remembers which application this session is now working against, so the
  // per-document "Update application" actions save into it instead of creating
  // a second record.
  linkApplication: (id: string | null) => void;
  currentJobTracking: () => ExtractedJobTracking;
  resolveApplyDuplicate: (isCurrent: () => boolean) => Promise<DuplicateResolution>;
  // Whether each PDF can actually be TYPESET, which is stricter than the export
  // rail's enabled-state: the engine needs the structured model, so a text-only
  // polish result must not put a resume checkbox in the download prompt.
  canExportResumePdf: boolean;
  canExportCoverLetter: boolean;
  // Both resolve false when the export fails; the Apply flow owns the message
  // because each editor's own status surface is no longer on screen by then.
  handleDownloadPdf: (overrideBase?: string) => Promise<boolean>;
  handleDownloadCoverLetterPdf: (overrideBase?: string) => Promise<boolean>;
  getResumeArtifacts: () => Promise<DocumentUpload | null>;
  getCoverLetterArtifacts: () => Promise<DocumentUpload | null>;
  resumeDocumentVersion: string;
  coverLetterDocumentVersion: string;
  onResumeSaved: () => void;
  onCoverLetterSaved: () => void;
  setApplicationPersistenceReceipt: Dispatch<
    SetStateAction<ApplicationPersistenceReceipt | null>
  >;
  // Accepts an updater so a late failure can APPEND to the status commitApply
  // already set, instead of erasing an artifact-save warning the user needs.
  setApplicationActionStatus: Dispatch<SetStateAction<ApplicationActionStatus | null>>;
  setActiveOutputTab: (tab: OutputTab) => void;
  setExpandedApplicationId: (id: string | null) => void;
};

export function useApplyFlow({
  canApply,
  applyBlocker,
  includeResume,
  includeCoverLetter,
  jobUrl,
  preparedJobDescription,
  jobRawText,
  result,
  currentResumeText,
  fitAssessmentPersistence,
  pipelineAiUsage,
  preparationSession,
  currentPreparationId,
  getCurrentPreparationId,
  getPreparationGeneration,
  getApplication,
  refreshApplications,
  createApplication,
  updateApplicationById,
  linkPostingRecords,
  markPostingRecordsUnrelated,
  saveApplicationDocument,
  linkApplication,
  currentJobTracking,
  resolveApplyDuplicate,
  canExportResumePdf,
  canExportCoverLetter,
  handleDownloadPdf,
  handleDownloadCoverLetterPdf,
  getResumeArtifacts,
  getCoverLetterArtifacts,
  resumeDocumentVersion,
  coverLetterDocumentVersion,
  onResumeSaved,
  onCoverLetterSaved,
  setApplicationPersistenceReceipt,
  setApplicationActionStatus,
  setActiveOutputTab,
  setExpandedApplicationId
}: UseApplyFlowArgs) {
  const applySessionRef = useRef<PreparationSession | null>(null);
  const applyActionRef = useRef<PreparationPrimaryAction | null>(null);
  const applyUnrelatedApplicationIdRef = useRef<string | null>(null);
  const applyCommitIdentityRef = useRef<string | null>(null);
  const applyPreparationIdRef = useRef<string | null>(null);
  const applyPreparationGenerationRef = useRef<number | null>(null);
  const applyMaterialSelectionRef = useRef<{
    resume: boolean;
    coverLetter: boolean;
  } | null>(null);
  const currentMaterialSelectionRef = useRef({
    resume: includeResume,
    coverLetter: includeCoverLetter
  });
  currentMaterialSelectionRef.current = {
    resume: includeResume,
    coverLetter: includeCoverLetter
  };
  const applyDocumentVersionsRef = useRef<{
    resume: string;
    coverLetter: string;
  } | null>(null);
  // Post-Apply download prompt: holds the just-applied role's label and which
  // included materials this Apply can actually export, so the dialog offers a
  // cover-letter PDF whenever the letter is part of the application.
  const [applyDownloadPrompt, setApplyDownloadPrompt] = useState<{
    label: string;
    canDownloadResume: boolean;
    canDownloadCoverLetter: boolean;
    action: PreparationPrimaryAction;
  } | null>(null);
  const [isResolvingApply, setIsResolvingApply] = useState(false);
  const [isCommittingApply, setIsCommittingApply] = useState(false);
  const [isDownloadingApplyPdfs, setIsDownloadingApplyPdfs] = useState(false);
  const [applySaveError, setApplySaveError] = useState("");
  const applyResolutionInFlightRef = useRef(false);
  const applyCommitInFlightRef = useRef(false);
  const applyDownloadInFlightRef = useRef(false);
  const isApplying = isResolvingApply || isCommittingApply || isDownloadingApplyPdfs;
  const currentPreparationIdentityRef = useRef("");
  currentPreparationIdentityRef.current = preparationCommitIdentity({
    session: preparationSession,
    preparationId: currentPreparationId,
    jobUrl,
    preparedJobDescription,
    jobRawText
  });
  const latestDocumentVersionsRef = useRef({
    resume: resumeDocumentVersion,
    coverLetter: coverLetterDocumentVersion
  });
  latestDocumentVersionsRef.current = {
    resume: resumeDocumentVersion,
    coverLetter: coverLetterDocumentVersion
  };
  const canApplyRef = useRef(canApply);
  const applyBlockerRef = useRef(applyBlocker);
  canApplyRef.current = canApply;
  applyBlockerRef.current = applyBlocker;

  function clearCapturedApply(): void {
    applyMaterialSelectionRef.current = null;
    applyDocumentVersionsRef.current = null;
    applyPreparationIdRef.current = null;
    applyPreparationGenerationRef.current = null;
    applySessionRef.current = null;
    applyActionRef.current = null;
    applyUnrelatedApplicationIdRef.current = null;
    applyCommitIdentityRef.current = null;
  }

  function capturedPreparationIsCurrent(): boolean {
    return applyCommitIdentityRef.current !== null
      && applyPreparationIdRef.current === getCurrentPreparationId()
      && applyPreparationGenerationRef.current === getPreparationGeneration()
      && applyCommitIdentityRef.current === currentPreparationIdentityRef.current;
  }

  function ownsCurrentPreparation(applicationId: string): boolean {
    return capturedPreparationIsCurrent()
      && Boolean(getApplication(applicationId));
  }

  function capturedApplyPacketIsCurrent(): boolean {
    const selection = applyMaterialSelectionRef.current;
    const expectedVersions = applyDocumentVersionsRef.current;
    if (!selection || !expectedVersions) return false;
    const currentSelection = currentMaterialSelectionRef.current;
    return selection.resume === currentSelection.resume
      && selection.coverLetter === currentSelection.coverLetter
      && (!selection.resume || expectedVersions.resume === latestDocumentVersionsRef.current.resume)
      && (
        !selection.coverLetter
        || expectedVersions.coverLetter === latestDocumentVersionsRef.current.coverLetter
      );
  }

  // Persist the package captured when Apply began; excluded documents remain untouched.
  async function saveAppliedDocumentArtifacts(
    id: string,
    label: string,
    expectedVersions: { resume: string; coverLetter: string },
    action: PreparationPrimaryAction,
    relationshipWarning: string
  ) {
    const selection = applyMaterialSelectionRef.current ?? currentMaterialSelectionRef.current;
    const resume = selection.resume ? await getResumeArtifacts().catch(() => null) : null;
    const cover = selection.coverLetter ? await getCoverLetterArtifacts().catch(() => null) : null;
    const storedResume = selection.resume
      ? resume
        ? latestDocumentVersionsRef.current.resume === expectedVersions.resume
          ? await saveApplicationDocument(id, "resume", resume)
          : { ok: false, error: "The resume changed before it could be saved." }
        : { ok: false, error: "No editable resume source is available." }
      : null;
    const storedCover = selection.coverLetter
      ? cover
        ? latestDocumentVersionsRef.current.coverLetter ===
          expectedVersions.coverLetter
          ? await saveApplicationDocument(id, "cover", cover)
          : { ok: false, error: "The cover letter changed before it could be saved." }
        : { ok: false, error: "No editable cover-letter source is available." }
      : null;
    const currentStoredResume =
      storedResume?.ok &&
      latestDocumentVersionsRef.current.resume !== expectedVersions.resume
        ? {
            ok: false,
            error:
              "The resume changed while saving, so the application has the earlier version."
          }
        : storedResume;
    const currentStoredCover =
      storedCover?.ok &&
      latestDocumentVersionsRef.current.coverLetter !==
        expectedVersions.coverLetter
        ? {
            ok: false,
            error:
              "The cover letter changed while saving, so the application has the earlier version."
          }
        : storedCover;
    const failures = [
      ...(selection.resume && !currentStoredResume?.ok
        ? [{ name: "resume", message: currentStoredResume?.error ?? "The resume could not be saved." }]
        : []),
      ...(selection.coverLetter && !currentStoredCover?.ok
        ? [{
            name: "cover letter",
            message: currentStoredCover?.error ?? "The cover letter could not be saved."
          }]
        : [])
    ];
    if (failures.length) {
      setApplicationActionStatus({
        tone: "error",
        headline: `${action.receipt} — ${failures.map((failure) => failure.name).join(" and ")} not saved`,
        detail: statusDetail(
          `${label} ·`,
          failures.map((failure) => failure.message).join(" "),
          "Retry from the document's Save menu.",
          relationshipWarning
        )
      });
      return {
        resumeSaved: Boolean(currentStoredResume?.ok),
        coverSaved: Boolean(currentStoredCover?.ok),
        resumeOutcome: selection.resume
          ? currentStoredResume?.ok ? "saved" as const : "failed" as const
          : "excluded" as const,
        coverOutcome: selection.coverLetter
          ? currentStoredCover?.ok ? "saved" as const : "failed" as const
          : "excluded" as const
      };
    }
    const savedLabels = [
      ...(currentStoredResume?.ok ? ["resume"] : []),
      ...(currentStoredCover?.ok ? ["cover letter"] : [])
    ];
    // A record saved without its posting link is partial: sticky, not expiring.
    setApplicationActionStatus({
      tone: relationshipWarning ? "error" : "success",
      headline: relationshipWarning
        ? `${action.receipt} — relationship update failed`
        : action.receipt,
      detail: statusDetail(
        savedLabels.length
          ? `${label} · Saved ${savedLabels.join(" and ")}.`
          : `${label} · No documents were included.`,
        relationshipWarning
      )
    });
    return {
      resumeSaved: Boolean(currentStoredResume?.ok),
      coverSaved: Boolean(currentStoredCover?.ok),
      resumeOutcome: selection.resume ? "saved" as const : "excluded" as const,
      coverOutcome: selection.coverLetter ? "saved" as const : "excluded" as const
    };
  }

  // Commit the current session through its explicit create/update path, then
  // snapshot included artifacts and update UI.
  // Called directly when the user has opted to skip the download dialog, or
  // from the dialog's Download / Apply-only callbacks.
  async function commitApply(): Promise<boolean> {
    const session = applySessionRef.current ?? preparationSession;
    const existing = session.applicationId
      ? getApplication(session.applicationId) ?? null
      : null;
    const action = applyActionRef.current
      ?? preparationPrimaryAction(session, existing?.status);
    if (!capturedPreparationIsCurrent()) {
      const message = `The prepared job changed before ${action.label} could be saved. Retry ${action.label}.`;
      setApplySaveError(message);
      setApplicationActionStatus({ tone: "error", headline: "Nothing was saved", detail: message });
      clearCapturedApply();
      setApplyDownloadPrompt(null);
      return false;
    }
    if (!capturedApplyPacketIsCurrent()) {
      const message = `Included materials changed before ${action.label} could be saved. Retry ${action.label}.`;
      setApplySaveError(message);
      setApplicationActionStatus({ tone: "error", headline: "Nothing was saved", detail: message });
      clearCapturedApply();
      setApplyDownloadPrompt(null);
      return false;
    }
    if (!canApplyRef.current) {
      const message = applyBlockerRef.current || "Finish preparation before continuing.";
      setApplySaveError(message);
      setApplicationActionStatus({
        tone: "error",
        headline: `Can't ${action.label.toLowerCase()} yet`,
        detail: message
      });
      return false;
    }
    if (applyCommitInFlightRef.current) return false;
    setApplicationActionStatus(null);
    applyCommitInFlightRef.current = true;
    setApplicationPersistenceReceipt(null);
    // Later edits must not let an older artifact mark the live document clean.
    const expectedDocumentVersions = { ...applyDocumentVersionsRef.current! };
    setIsCommittingApply(true);
    setApplySaveError("");
    const resumeUsed = resumeUsedForApplication(currentResumeText, result?.proposalBaselineText);
    const usedBase = resumeUsed === "base";
    const materialSelection = applyMaterialSelectionRef.current ?? currentMaterialSelectionRef.current;
    if (session.mode !== "new" && !existing) {
      const message = "The saved record for this preparation is no longer available. Return to Applications and open it again.";
      setApplySaveError(message);
      setApplicationActionStatus({ tone: "error", headline: "Nothing was saved", detail: message });
      applyCommitInFlightRef.current = false;
      setIsCommittingApply(false);
      return false;
    }
    let commit: ReturnType<typeof appliedApplicationForSession>;
    try {
      const now = new Date().toISOString();
      const tracking = currentJobTracking();
      const baseRecord = makeApplicationRecord(jobUrl, preparedJobDescription, "applied", tracking);
      const prepared = preparedApplicationRecord({
        base: baseRecord,
        existing,
        jobUrl,
        preparedJobDescription,
        jobRawText,
        tracking,
        pipelineAiUsage,
        fitAssessmentPersistence,
        now,
        usage: {
          mode: "application",
          includeResume: materialSelection.resume,
          includeCoverLetter: materialSelection.coverLetter,
          resumeUsed: usedBase ? "base" : "tailored"
        }
      });
      commit = appliedApplicationForSession({
        session,
        prepared: prepared.application,
        existing,
        now,
        clearFields: prepared.clearFields
      });
    } catch {
      const message = `${action.label} could not be prepared for saving. Your recovery draft is still available; retry ${action.label}.`;
      setApplySaveError(message);
      setApplicationActionStatus({ tone: "error", headline: "Nothing was saved", detail: message });
      applyCommitInFlightRef.current = false;
      setIsCommittingApply(false);
      return false;
    }
    if (!commit) {
      const message = "The saved record no longer matches this preparation mode. Reopen it from Applications and try again.";
      setApplySaveError(message);
      setApplicationActionStatus({ tone: "error", headline: "Nothing was saved", detail: message });
      applyCommitInFlightRef.current = false;
      setIsCommittingApply(false);
      return false;
    }
    const app = commit.application;
    let saved = false;
    try {
      saved = commit.operation === "create"
        ? await createApplication(app)
        : await updateApplicationById(app);
    } catch {
      // The store normally converts request failures to `false`; keep this
      // boundary fail-closed if a future adapter rejects unexpectedly.
    }
    if (!saved) {
      const message = `${action.label} could not be saved. Your recovery draft is still available; retry ${action.label}.`;
      setApplySaveError(message);
      setApplicationActionStatus({ tone: "error", headline: "Nothing was saved", detail: message });
      applyCommitInFlightRef.current = false;
      setIsCommittingApply(false);
      return false;
    }
    let relationshipWarning = "";
    if (commit.operation === "create" && session.pendingRelationship) {
      const relationship = session.pendingRelationship;
      const linkedGroupId = await linkPostingRecords(
        [app.id, relationship.matchedApplicationId],
        relationship.jobPostingGroupId
      ).catch(() => null);
      if (!linkedGroupId) {
        relationshipWarning = "The related posting could not be linked; both records remain separate.";
      }
    } else if (commit.operation === "create" && applyUnrelatedApplicationIdRef.current) {
      const savedSeparation = await markPostingRecordsUnrelated([
        app.id,
        applyUnrelatedApplicationIdRef.current
      ]).catch(() => false);
      if (!savedSeparation) {
        relationshipWarning = "The Keep separate decision could not be saved; the records may appear in duplicate review.";
      }
    }
    try {
      if (ownsCurrentPreparation(app.id)) {
        setActiveOutputTab("applications");
        setExpandedApplicationId(app.id);
      }
      const savedDocuments = await saveAppliedDocumentArtifacts(
        app.id,
        app.title,
        expectedDocumentVersions,
        action,
        relationshipWarning
      );
      if (ownsCurrentPreparation(app.id)) {
        setApplicationPersistenceReceipt({
          applicationId: app.id,
          resume: {
            version: expectedDocumentVersions.resume,
            outcome: savedDocuments.resumeOutcome
          },
          coverLetter: {
            version: expectedDocumentVersions.coverLetter,
            outcome: savedDocuments.coverOutcome
          }
        });
        // Tracker text is not a reloadable document. Preserve recovery until the
        // corresponding strict editable source has also been committed.
        if (savedDocuments.resumeSaved) onResumeSaved();
        if (savedDocuments.coverSaved) onCoverLetterSaved();
      }
      return true;
    } catch {
      setApplicationActionStatus({
        tone: "error",
        headline: `${action.receipt} — follow-up unconfirmed`,
        detail: statusDetail(
          `${app.title} ·`,
          "Post-save updates could not be confirmed. Review Applications before retrying document saves.",
          relationshipWarning
        )
      });
      return true;
    } finally {
      const shouldLinkApplication = ownsCurrentPreparation(app.id);
      clearCapturedApply();
      applyCommitInFlightRef.current = false;
      setIsCommittingApply(false);
      if (shouldLinkApplication) linkApplication(app.id);
    }
  }

  // New preparations run duplicate review before commit. Update sessions carry
  // their exact id and must never resolve another write target.
  async function handleApply() {
    if (
      applyResolutionInFlightRef.current ||
      applyCommitInFlightRef.current ||
      applyDownloadInFlightRef.current
    ) return;
    const session = preparationSession;
    const existing = session.applicationId
      ? getApplication(session.applicationId) ?? null
      : null;
    const action = preparationPrimaryAction(session, existing?.status);
    if (!canApply) {
      setApplicationActionStatus({
        tone: "error",
        headline: `Can't ${action.label.toLowerCase()} yet`,
        detail: applyBlocker || "Finish preparation before continuing."
      });
      return;
    }
    applyResolutionInFlightRef.current = true;
    setIsResolvingApply(true);
    try {
      setApplicationActionStatus(null);
      applyMaterialSelectionRef.current = {
        ...currentMaterialSelectionRef.current
      };
      applyDocumentVersionsRef.current = {
        ...latestDocumentVersionsRef.current
      };
      applySessionRef.current = session;
      applyActionRef.current = action;
      applyUnrelatedApplicationIdRef.current = null;
      applyCommitIdentityRef.current = preparationCommitIdentity({
        session,
        preparationId: currentPreparationId,
        jobUrl,
        preparedJobDescription,
        jobRawText
      });
      applyPreparationIdRef.current = currentPreparationId;
      applyPreparationGenerationRef.current = getPreparationGeneration();
      const isCurrent = () => capturedPreparationIsCurrent();
      let resolution: DuplicateResolution = { action: "continue", relationship: null };
      if (session.mode === "new") {
        if (!(await refreshApplications())) {
          clearCapturedApply();
          setApplicationActionStatus({
            tone: "error",
            headline: "Nothing was saved",
            detail: `Applications could not be refreshed. Retry ${action.label}.`
          });
          return;
        }
        if (!isCurrent()) {
          clearCapturedApply();
          return;
        }
        try {
          resolution = await resolveApplyDuplicate(isCurrent);
        } catch {
          clearCapturedApply();
          setApplicationActionStatus({
            tone: "error",
            headline: "Nothing was saved",
            detail: "Duplicate checking failed. Retry Apply."
          });
          return;
        }
      }
      if (resolution.action !== "continue") {
        clearCapturedApply();
        return;
      }
      applyUnrelatedApplicationIdRef.current = resolution.unrelatedApplicationId ?? null;
      if (session.mode === "new") {
        applySessionRef.current = {
          ...session,
          pendingRelationship: resolution.relationship
        };
      }

      const canDownloadResume = applyMaterialSelectionRef.current.resume && canExportResumePdf;
      const canDownloadCoverLetter =
        applyMaterialSelectionRef.current.coverLetter && canExportCoverLetter;
      if (!canDownloadResume && !canDownloadCoverLetter) {
        await commitApply();
        return;
      }
      const baseRecord = makeApplicationRecord(
        jobUrl,
        preparedJobDescription,
        "applied",
        currentJobTracking()
      );
      setApplySaveError("");
      setApplyDownloadPrompt({
        label: existing?.title || baseRecord.title,
        canDownloadResume,
        canDownloadCoverLetter,
        action
      });
    } finally {
      applyResolutionInFlightRef.current = false;
      setIsResolvingApply(false);
    }
  }

  // Downloads run sequentially: two near-simultaneous programmatic downloads
  // trip the browser's multiple-download prompt, and a failed second render
  // must not look like the first one failed. A failed export never undoes the
  // apply — it only appends to the status, because the application and its
  // saved artifacts are already committed by this point.
  async function handleApplyDownloadPick(names: ApplyDownloadNames, picks: ApplyDownloadPicks) {
    if (
      applyResolutionInFlightRef.current ||
      applyDownloadInFlightRef.current ||
      applyCommitInFlightRef.current
    ) return;
    applyDownloadInFlightRef.current = true;
    setIsDownloadingApplyPdfs(true);
    const action = applyDownloadPrompt?.action
      ?? applyActionRef.current
      ?? preparationPrimaryAction(preparationSession);
    try {
      if (!(await commitApply())) return;
      const exportResume = async () => await handleDownloadPdf(names.resume || undefined);
      const exportCoverLetter = async () =>
        await handleDownloadCoverLetterPdf(names.coverLetter || undefined);
      const failed = await runApplyPdfExports({
        resume: picks.resume ? exportResume : undefined,
        coverLetter: picks.coverLetter ? exportCoverLetter : undefined
      });
      if (failed.length) {
        const reason =
          `The ${failed.join(" and ")} PDF${failed.length > 1 ? "s" : ""} could not be exported.` +
          ` Retry from ${failed.length > 1 ? "each" : "that"} document's own export menu.`;
        // commitApply has already reported the commit and any artifact-save
        // problem; add to its detail rather than replacing it.
        setApplicationActionStatus((current) => ({
          tone: "error",
          headline: `${action.receipt} — PDF export failed`,
          detail: statusDetail(current?.detail, reason)
        }));
      }
      // Keep the modal mounted and busy until every selected attempt settles.
      // It is the lock that prevents edits between the saved artifact snapshot
      // and a later sequential export. A failed commit returns above and keeps
      // the same prompt open for retry.
      setApplyDownloadPrompt(null);
    } finally {
      applyDownloadInFlightRef.current = false;
      setIsDownloadingApplyPdfs(false);
    }
  }

  async function handleApplyOnly() {
    if (
      applyResolutionInFlightRef.current ||
      applyCommitInFlightRef.current ||
      applyDownloadInFlightRef.current
    ) return;
    if (!(await commitApply())) return;
    setApplyDownloadPrompt(null);
  }

  function cancelApply() {
    clearCapturedApply();
    setApplyDownloadPrompt(null);
  }

  return {
    applyDownloadPrompt,
    isApplying,
    // PDF exports remain part of isApplying but not the persistence phase.
    applicationSavePending: isCommittingApply,
    applySaveError,
    handleApply,
    handleApplyDownloadPick,
    handleApplyOnly,
    cancelApply
  };
}
