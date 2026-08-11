import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  makeApplicationDraft,
  type Application,
  type NotApplyingReason
} from "./useApplications.ts";
import type { DuplicateResolution } from "./useDuplicateGuard.ts";
import type { ExtractedJobTracking } from "../lib/jobExtract.ts";
import type { StageAiUsage } from "../lib/aiUsage.ts";
import type { FitAssessmentPersistenceDecision } from "../lib/fitAssessmentLifecycle.ts";
import type { PreparationSession } from "../lib/preparationSession.ts";
import { preparedApplicationRecord } from "../lib/preparedApplicationRecord.ts";
import {
  passApplicationForSession,
  updateNotApplyingJob
} from "../lib/notApplyingApplication.ts";

export type PassPrompt = {
  initialReason: NotApplyingReason | "";
  initialNote: string;
};

type UsePassFlowArgs = {
  canPass: boolean;
  passBlocker: string;
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

export function usePassFlow({
  canPass,
  passBlocker,
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
}: UsePassFlowArgs) {
  const [passPrompt, setPassPrompt] = useState<PassPrompt | null>(null);
  const [passError, setPassError] = useState("");
  const [isResolvingPass, setIsResolvingPass] = useState(false);
  const [isSavingPass, setIsSavingPass] = useState(false);
  const passInFlightRef = useRef(false);
  const passSessionRef = useRef<PreparationSession | null>(null);
  const unrelatedApplicationIdRef = useRef<string | null>(null);
  const isPassing = isResolvingPass || isSavingPass;

  function clearCapturedPass(): void {
    passSessionRef.current = null;
    unrelatedApplicationIdRef.current = null;
  }

  async function handlePass(): Promise<void> {
    if (passInFlightRef.current) return;
    if (!canPass) {
      setApplyStatus(passBlocker || "Prepare the posting before passing on it.");
      return;
    }
    passInFlightRef.current = true;
    setIsResolvingPass(true);
    setPassError("");
    try {
      const session = preparationSession;
      let resolution: DuplicateResolution = { action: "continue", relationship: null };
      if (session.mode === "new") {
        try {
          resolution = await resolvePreparationDuplicate();
        } catch {
          const message = "Duplicate checking failed, so the job was not saved. Retry Pass on this job.";
          setPassError(message);
          setApplyStatus(message);
          return;
        }
      }
      if (resolution.action !== "continue") return;
      const capturedSession = session.mode === "new"
        ? { ...session, pendingRelationship: resolution.relationship }
        : session;
      passSessionRef.current = capturedSession;
      unrelatedApplicationIdRef.current = resolution.unrelatedApplicationId ?? null;
      const matchedNotApplyingId = capturedSession.pendingRelationship?.matchedNotApplyingRecordId;
      const matchedNotApplying = matchedNotApplyingId
        ? applications.find((application) => application.id === matchedNotApplyingId) ?? null
        : null;
      setPassPrompt({
        initialReason: matchedNotApplying?.notApplyingReason ?? "",
        initialNote: matchedNotApplying?.notApplyingNote ?? ""
      });
    } finally {
      passInFlightRef.current = false;
      setIsResolvingPass(false);
    }
  }

  async function savePass(reason: NotApplyingReason | "", note: string): Promise<boolean> {
    if (passInFlightRef.current) return false;
    const session = passSessionRef.current ?? preparationSession;
    if (session.mode === "update") return false;
    passInFlightRef.current = true;
    setIsSavingPass(true);
    setPassError("");
    try {
      const existing = session.mode === "draft"
        ? applications.find((application) => application.id === session.applicationId) ?? null
        : null;
      const matchedNotApplyingId = session.pendingRelationship?.matchedNotApplyingRecordId;
      const matchedNotApplying = matchedNotApplyingId
        ? applications.find((application) => application.id === matchedNotApplyingId) ?? null
        : null;
      const now = new Date().toISOString();
      const tracking = currentJobTracking();
      const draft = makeApplicationDraft(jobUrl, preparedJobDescription, tracking);
      const prepared = preparedApplicationRecord({
        draft,
        existing: existing ?? matchedNotApplying,
        jobUrl,
        preparedJobDescription,
        jobRawText,
        tracking,
        pipelineAiUsage,
        fitAssessmentPersistence,
        now,
        usage: { mode: "job-only" }
      });
      const commit = passApplicationForSession({
        session,
        prepared: prepared.application,
        existing,
        matchedNotApplying,
        now,
        reason,
        note,
        clearFields: prepared.clearFields
      });
      if (!commit) {
        const message = "The saved draft or prior decision is no longer available. Nothing was saved; reopen the posting and try again.";
        setPassError(message);
        setApplyStatus(message);
        return false;
      }

      const saved = commit.operation === "create"
        ? await createApplication(commit.application).catch(() => false)
        : await updateApplicationById(commit.application).catch(() => false);
      if (!saved) {
        const message = "Not applying could not be saved. The prepared job and your decision are still here; retry Save as not applying.";
        setPassError(message);
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
        `Saved as Not applying. RoleFit will recognize this posting if you encounter it again.${relationshipWarning}`
      );
      setPassPrompt(null);
      clearCapturedPass();
      return true;
    } finally {
      passInFlightRef.current = false;
      setIsSavingPass(false);
    }
  }

  async function saveJobUpdates(): Promise<boolean> {
    if (passInFlightRef.current) return false;
    const session = preparationSession;
    const existing = session.applicationId
      ? applications.find((application) => application.id === session.applicationId) ?? null
      : null;
    passInFlightRef.current = true;
    setIsSavingPass(true);
    setPassError("");
    try {
      const now = new Date().toISOString();
      const tracking = currentJobTracking();
      const draft = makeApplicationDraft(jobUrl, preparedJobDescription, tracking);
      const prepared = preparedApplicationRecord({
        draft,
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
        setPassError(message);
        setApplyStatus(message);
        return false;
      }
      setApplyStatus(`Saved job updates for "${commit.application.title}".`);
      return true;
    } finally {
      passInFlightRef.current = false;
      setIsSavingPass(false);
    }
  }

  function cancelPass(): void {
    if (isPassing) return;
    setPassPrompt(null);
    setPassError("");
    clearCapturedPass();
  }

  return {
    passPrompt,
    passError,
    isPassing,
    handlePass,
    savePass,
    saveJobUpdates,
    cancelPass
  };
}
