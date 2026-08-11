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
  type PreparationSession
} from "../lib/preparationSession.ts";
import { preparedApplicationRecord } from "../lib/preparedApplicationRecord.ts";
import {
  skipApplicationForSession,
  updateNotApplyingJob
} from "../lib/notApplyingApplication.ts";

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
  applications: Application[];
  preparationSession: PreparationSession;
  currentJobTracking: () => ExtractedJobTracking;
  resolvePreparationDuplicate: () => Promise<DuplicateResolution>;
  createApplication: (application: Application) => Promise<boolean>;
  updateApplicationById: (application: Application) => Promise<boolean>;
  linkPostingRecords: (applicationIds: string[], groupId?: string) => Promise<string | null>;
  markPostingRecordsUnrelated: (applicationIds: string[]) => Promise<boolean>;
  linkApplication: (id: string | null) => void;
  setApplyStatus: Dispatch<SetStateAction<string>>;
};

export function useSkipFlow({
  canSkip,
  skipBlocker,
  jobUrl,
  preparedJobDescription,
  jobRawText,
  pipelineAiUsage,
  fitAssessmentPersistence,
  applications,
  preparationSession,
  currentJobTracking,
  resolvePreparationDuplicate,
  createApplication,
  updateApplicationById,
  linkPostingRecords,
  markPostingRecordsUnrelated,
  linkApplication,
  setApplyStatus
}: UseSkipFlowArgs) {
  const [skipPrompt, setSkipPrompt] = useState<SkipPrompt | null>(null);
  const [skipError, setSkipError] = useState("");
  const [isResolvingSkip, setIsResolvingSkip] = useState(false);
  const [isSavingSkip, setIsSavingSkip] = useState(false);
  const skipInFlightRef = useRef(false);
  const skipSessionRef = useRef<PreparationSession | null>(null);
  const unrelatedApplicationIdRef = useRef<string | null>(null);
  const skipCommitIdentityRef = useRef<string | null>(null);
  const isSkipping = isResolvingSkip || isSavingSkip;

  function clearCapturedSkip(): void {
    skipSessionRef.current = null;
    unrelatedApplicationIdRef.current = null;
    skipCommitIdentityRef.current = null;
  }

  async function handleSkip(): Promise<void> {
    if (skipInFlightRef.current) return;
    if (!canSkip) {
      setApplyStatus(skipBlocker || "Prepare the posting before skipping it.");
      return;
    }
    skipInFlightRef.current = true;
    setIsResolvingSkip(true);
    setSkipError("");
    try {
      const session = preparationSession;
      skipCommitIdentityRef.current = preparationCommitIdentity({
        session,
        jobUrl,
        preparedJobDescription,
        jobRawText
      });
      let resolution: DuplicateResolution = { action: "continue", relationship: null };
      if (session.mode === "new") {
        try {
          resolution = await resolvePreparationDuplicate();
        } catch {
          const message = "Duplicate checking failed, so the job was not saved. Retry Skip & save job.";
          setSkipError(message);
          setApplyStatus(message);
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
        ? applications.find((application) => application.id === matchedNotApplyingId) ?? null
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
    if (
      skipCommitIdentityRef.current !== preparationCommitIdentity({
        session: preparationSession,
        jobUrl,
        preparedJobDescription,
        jobRawText
      })
    ) {
      const message = "The prepared job changed while this decision was open. Nothing was saved; cancel and choose Skip again.";
      setSkipError(message);
      setApplyStatus(message);
      return false;
    }
    skipInFlightRef.current = true;
    setIsSavingSkip(true);
    setSkipError("");
    try {
      const matchedNotApplyingId = session.pendingRelationship?.matchedNotApplyingRecordId;
      const matchedNotApplying = matchedNotApplyingId
        ? applications.find((application) => application.id === matchedNotApplyingId) ?? null
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
        const message = "The prior decision is no longer available. Nothing was saved; reopen the posting and try again.";
        setSkipError(message);
        setApplyStatus(message);
        return false;
      }

      const saved = commit.operation === "create"
        ? await createApplication(commit.application).catch(() => false)
        : await updateApplicationById(commit.application).catch(() => false);
      if (!saved) {
        const message = "This decision could not be saved. The prepared job and your reason are still here; retry Save as skipped.";
        setSkipError(message);
        setApplyStatus(message);
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
          relationshipWarning = " The related posting could not be linked; both records remain separate.";
        }
      } else if (commit.operation === "create" && unrelatedApplicationIdRef.current) {
        const separated = await markPostingRecordsUnrelated([
          commit.application.id,
          unrelatedApplicationIdRef.current
        ]).catch(() => false);
        if (!separated) {
          relationshipWarning = " The Keep separate decision could not be saved; the records may appear in duplicate review.";
        }
      }

      linkApplication(commit.application.id);
      setApplyStatus(
        `Saved as Skipped. RoleFit will recognize this posting if you encounter it again.${relationshipWarning}`
      );
      setSkipPrompt(null);
      clearCapturedSkip();
      return true;
    } catch {
      const message = "This decision could not be prepared or saved. The job and your reason are still here; retry Save as skipped.";
      setSkipError(message);
      setApplyStatus(message);
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
      ? applications.find((application) => application.id === session.applicationId) ?? null
      : null;
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
        setApplyStatus(message);
        return false;
      }
      setApplyStatus(`Saved job updates for "${commit.application.title}".`);
      return true;
    } catch {
      const message = "Job updates could not be prepared or saved. The preparation is still available; retry Save job updates.";
      setSkipError(message);
      setApplyStatus(message);
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
