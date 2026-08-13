import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  makeApplicationRecord,
  type Application,
  type NotApplyingReason
} from "./useApplications.ts";
import type { DuplicateResolution } from "./useDuplicateGuard.ts";
import type { ExtractedJobTracking } from "../lib/jobExtract.ts";
import type { StageAiUsage } from "../lib/aiUsage.ts";
import type { FitAssessmentPersistenceDecision } from "../lib/fitAssessmentLifecycle.ts";
import {
  preparationCommitIdentity,
  preparationPrimaryAction,
  type PreparationSession
} from "../lib/preparationSession.ts";
import { preparedApplicationRecord } from "../lib/preparedApplicationRecord.ts";
import {
  skipApplicationForSession,
  updateNotApplyingJob
} from "../lib/notApplyingApplication.ts";
import {
  statusDetail,
  type ApplicationActionStatus
} from "../lib/applicationActionStatus.ts";

export type SkipPrompt = {
  initialReason: NotApplyingReason | "";
  initialNote: string;
};

type UseSkipFlowArgs = {
  canSkip: boolean;
  skipBlocker: string;
  jobUrl: string;
  preparedJobDescription: string;
  jobRawText: string;
  pipelineAiUsage: Record<string, StageAiUsage>;
  fitAssessmentPersistence: FitAssessmentPersistenceDecision;
  preparationSession: PreparationSession;
  currentPreparationId: string;
  getCurrentPreparationId: () => string;
  getPreparationGeneration: () => number;
  getApplication: (id: string) => Application | undefined;
  refreshApplications: () => Promise<boolean>;
  currentJobTracking: () => ExtractedJobTracking;
  resolvePreparationDuplicate: (isCurrent: () => boolean) => Promise<DuplicateResolution>;
  createApplication: (application: Application) => Promise<boolean>;
  updateApplicationById: (application: Application) => Promise<boolean>;
  linkPostingRecords: (applicationIds: string[], groupId?: string) => Promise<string | null>;
  markPostingRecordsUnrelated: (applicationIds: string[]) => Promise<boolean>;
  linkApplication: (id: string | null) => void;
  setApplicationActionStatus: Dispatch<SetStateAction<ApplicationActionStatus | null>>;
};

export function useSkipFlow({
  canSkip,
  skipBlocker,
  jobUrl,
  preparedJobDescription,
  jobRawText,
  pipelineAiUsage,
  fitAssessmentPersistence,
  preparationSession,
  currentPreparationId,
  getCurrentPreparationId,
  getPreparationGeneration,
  getApplication,
  refreshApplications,
  currentJobTracking,
  resolvePreparationDuplicate,
  createApplication,
  updateApplicationById,
  linkPostingRecords,
  markPostingRecordsUnrelated,
  linkApplication,
  setApplicationActionStatus
}: UseSkipFlowArgs) {
  const [skipPrompt, setSkipPrompt] = useState<SkipPrompt | null>(null);
  const [skipError, setSkipError] = useState("");
  const [isResolvingSkip, setIsResolvingSkip] = useState(false);
  const [isSavingSkip, setIsSavingSkip] = useState(false);
  const skipInFlightRef = useRef(false);
  const skipSessionRef = useRef<PreparationSession | null>(null);
  const unrelatedApplicationIdRef = useRef<string | null>(null);
  const skipCommitIdentityRef = useRef<string | null>(null);
  const skipPreparationIdRef = useRef<string | null>(null);
  const skipPreparationGenerationRef = useRef<number | null>(null);
  const isSkipping = isResolvingSkip || isSavingSkip;
  const currentPreparationIdentityRef = useRef("");
  currentPreparationIdentityRef.current = preparationCommitIdentity({
    session: preparationSession,
    preparationId: currentPreparationId,
    jobUrl,
    preparedJobDescription,
    jobRawText
  });

  function clearCapturedSkip(): void {
    skipSessionRef.current = null;
    unrelatedApplicationIdRef.current = null;
    skipCommitIdentityRef.current = null;
    skipPreparationIdRef.current = null;
    skipPreparationGenerationRef.current = null;
  }

  function capturedPreparationIsCurrent(): boolean {
    return skipCommitIdentityRef.current !== null
      && skipPreparationIdRef.current === getCurrentPreparationId()
      && skipPreparationGenerationRef.current === getPreparationGeneration()
      && skipCommitIdentityRef.current === currentPreparationIdentityRef.current;
  }

  function ownsCurrentPreparation(applicationId: string): boolean {
    return capturedPreparationIsCurrent()
      && Boolean(getApplication(applicationId));
  }

  async function handleSkip(): Promise<void> {
    if (skipInFlightRef.current) return;
    if (!canSkip) {
      setApplicationActionStatus({
        tone: "error",
        headline: "Can't skip yet",
        detail: skipBlocker || "Prepare the posting before skipping it."
      });
      return;
    }
    setApplicationActionStatus(null);
    skipInFlightRef.current = true;
    setIsResolvingSkip(true);
    setSkipError("");
    try {
      const session = preparationSession;
      skipCommitIdentityRef.current = preparationCommitIdentity({
        session,
        preparationId: currentPreparationId,
        jobUrl,
        preparedJobDescription,
        jobRawText
      });
      skipPreparationIdRef.current = currentPreparationId;
      skipPreparationGenerationRef.current = getPreparationGeneration();
      const isCurrent = () => capturedPreparationIsCurrent();
      let resolution: DuplicateResolution = { action: "continue", relationship: null };
      if (session.mode === "new") {
        if (!(await refreshApplications())) {
          const message = "Applications could not be refreshed. Retry Skip & save job.";
          setSkipError(message);
          setApplicationActionStatus({ tone: "error", headline: "Nothing was saved", detail: message });
          clearCapturedSkip();
          return;
        }
        if (!isCurrent()) {
          clearCapturedSkip();
          return;
        }
        try {
          resolution = await resolvePreparationDuplicate(isCurrent);
        } catch {
          const message = "Duplicate checking failed. Retry Skip & save job.";
          setSkipError(message);
          setApplicationActionStatus({ tone: "error", headline: "Nothing was saved", detail: message });
          clearCapturedSkip();
          return;
        }
      }
      if (resolution.action !== "continue") {
        clearCapturedSkip();
        return;
      }
      const capturedSession = session.mode === "new"
        ? { ...session, pendingRelationship: resolution.relationship }
        : session;
      skipSessionRef.current = capturedSession;
      unrelatedApplicationIdRef.current = resolution.unrelatedApplicationId ?? null;
      const matchedNotApplyingId = capturedSession.pendingRelationship?.matchedNotApplyingRecordId;
      const matchedNotApplying = matchedNotApplyingId
        ? getApplication(matchedNotApplyingId) ?? null
        : null;
      setSkipPrompt({
        initialReason: matchedNotApplying?.notApplyingReason ?? "",
        initialNote: matchedNotApplying?.notApplyingNote ?? ""
      });
    } finally {
      skipInFlightRef.current = false;
      setIsResolvingSkip(false);
    }
  }

  async function saveSkip(reason: NotApplyingReason | "", note: string): Promise<boolean> {
    if (skipInFlightRef.current) return false;
    const session = skipSessionRef.current ?? preparationSession;
    if (session.mode === "update") return false;
    if (!capturedPreparationIsCurrent()) {
      const message = "The prepared job changed while this decision was open. Cancel and choose Skip again.";
      setSkipError(message);
      setApplicationActionStatus({ tone: "error", headline: "Nothing was saved", detail: message });
      return false;
    }
    setApplicationActionStatus(null);
    skipInFlightRef.current = true;
    setIsSavingSkip(true);
    setSkipError("");
    try {
      const matchedNotApplyingId = session.pendingRelationship?.matchedNotApplyingRecordId;
      const matchedNotApplying = matchedNotApplyingId
        ? getApplication(matchedNotApplyingId) ?? null
        : null;
      const now = new Date().toISOString();
      const tracking = currentJobTracking();
      const baseRecord = makeApplicationRecord(
        jobUrl,
        preparedJobDescription,
        "not_applying",
        tracking
      );
      const prepared = preparedApplicationRecord({
        base: baseRecord,
        existing: matchedNotApplying,
        jobUrl,
        preparedJobDescription,
        jobRawText,
        tracking,
        pipelineAiUsage,
        fitAssessmentPersistence,
        now,
        usage: { mode: "job-only" }
      });
      const commit = skipApplicationForSession({
        session,
        prepared: prepared.application,
        matchedNotApplying,
        now,
        reason,
        note,
        clearFields: prepared.clearFields
      });
      if (!commit) {
        const message = "The prior decision is no longer available. Reopen the posting and try again.";
        setSkipError(message);
        setApplicationActionStatus({ tone: "error", headline: "Nothing was saved", detail: message });
        return false;
      }

      const saved = commit.operation === "create"
        ? await createApplication(commit.application).catch(() => false)
        : await updateApplicationById(commit.application).catch(() => false);
      if (!saved) {
        const message = "This decision could not be saved. The prepared job and your reason are still here; retry Save as skipped.";
        setSkipError(message);
        setApplicationActionStatus({
          tone: "error",
          headline: "Nothing was saved",
          detail: "The job is still prepared. Choose Skip & save job again, then retry the decision."
        });
        return false;
      }

      let relationshipWarning = "";
      if (commit.operation === "create" && session.pendingRelationship) {
        const relationship = session.pendingRelationship;
        const linked = await linkPostingRecords(
          [commit.application.id, relationship.matchedApplicationId],
          relationship.jobPostingGroupId
        ).catch(() => null);
        if (!linked) {
          relationshipWarning = "The related posting could not be linked; both records remain separate.";
        }
      } else if (commit.operation === "create" && unrelatedApplicationIdRef.current) {
        const separated = await markPostingRecordsUnrelated([
          commit.application.id,
          unrelatedApplicationIdRef.current
        ]).catch(() => false);
        if (!separated) {
          relationshipWarning = "The Keep separate decision could not be saved; the records may appear in duplicate review.";
        }
      }

      if (ownsCurrentPreparation(commit.application.id)) linkApplication(commit.application.id);
      setApplicationActionStatus({
        tone: relationshipWarning ? "error" : "success",
        headline: relationshipWarning
          ? "Saved as skipped — relationship update failed"
          : "Saved as skipped",
        detail: statusDetail(
          `${commit.application.title} · RoleFit will recognize this posting if you encounter it again.`,
          relationshipWarning
        )
      });
      setSkipPrompt(null);
      clearCapturedSkip();
      return true;
    } catch {
      const message = "This decision could not be prepared or saved. The job and your reason are still here; retry Save as skipped.";
      setSkipError(message);
      setApplicationActionStatus({
        tone: "error",
        headline: "Nothing was saved",
        detail: "The job is still prepared. Choose Skip & save job again, then retry the decision."
      });
      return false;
    } finally {
      skipInFlightRef.current = false;
      setIsSavingSkip(false);
    }
  }

  async function saveJobUpdates(): Promise<boolean> {
    if (skipInFlightRef.current) return false;
    const session = preparationSession;
    const existing = session.applicationId
      ? getApplication(session.applicationId) ?? null
      : null;
    const action = preparationPrimaryAction(session, existing?.status);
    setApplicationActionStatus(null);
    skipInFlightRef.current = true;
    setIsSavingSkip(true);
    setSkipError("");
    try {
      const now = new Date().toISOString();
      const tracking = currentJobTracking();
      const baseRecord = makeApplicationRecord(
        jobUrl,
        preparedJobDescription,
        "not_applying",
        tracking
      );
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
        usage: { mode: "job-only" }
      });
      const commit = updateNotApplyingJob({
        session,
        prepared: prepared.application,
        existing,
        clearFields: prepared.clearFields
      });
      if (!commit || !(await updateApplicationById(commit.application).catch(() => false))) {
        const message = "Job updates could not be saved. The preparation is still available; retry Save job updates.";
        setSkipError(message);
        setApplicationActionStatus({ tone: "error", headline: "Nothing was saved", detail: message });
        return false;
      }
      setApplicationActionStatus({
        tone: "success",
        headline: action.receipt,
        detail: commit.application.title
      });
      return true;
    } catch {
      const message = "Job updates could not be prepared or saved. The preparation is still available; retry Save job updates.";
      setSkipError(message);
      setApplicationActionStatus({ tone: "error", headline: "Nothing was saved", detail: message });
      return false;
    } finally {
      skipInFlightRef.current = false;
      setIsSavingSkip(false);
    }
  }

  function cancelSkip(): void {
    if (isSkipping) return;
    setSkipPrompt(null);
    setSkipError("");
    clearCapturedSkip();
  }

  return {
    skipPrompt,
    skipError,
    isSkipping,
    handleSkip,
    saveSkip,
    saveJobUpdates,
    cancelSkip
  };
}
