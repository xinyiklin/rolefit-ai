import { useEffect, useRef, useState } from "react";
import { buildStageRequestFields, type StageConfig } from "../lib/aiRequest";
import { classifyFailure, ApiError } from "../lib/failures";
import type { ApplicationAnswersResult } from "../sections/shared";
import {
  workflowInputFingerprint,
  workflowRequestIsCurrent,
  type AiStageState as StageState
} from "../lib/aiWorkflow";
import { buildApplicationRoleEvidence } from "../lib/applicationAnswerEvidence";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import { makeApplicationDraft, type Application } from "./useApplications";
import type { ExtractedJobTracking } from "../lib/jobExtract";
import type { DuplicateResolution } from "./useDuplicateGuard.ts";
import type { PreparationSession } from "../lib/preparationSession.ts";
import { applicationAnswerCommit } from "../lib/applicationAnswerCommit.ts";

type UseApplicationAnswersArgs = {
  resumeText: string;
  resumeData: ResumeData | null;
  jobDescription: string;
  applicationJobDescription: string;
  applicationRawJobDescription: string;
  applicationTracking: ExtractedJobTracking;
  linkedApplication: Application | null;
  jobUrl: string;
  honestContext: string;
  customInstructions: string;
  aiRequest: StageConfig;
  providerReady: boolean;
  providerMessage: string;
  preparationSession: PreparationSession;
  hasLoadedApplications: boolean;
  createApplication: (app: Application) => Promise<boolean>;
  updateApplicationById: (app: Application) => Promise<boolean>;
  linkPostingRecords: (applicationIds: string[], groupId?: string) => Promise<string | null>;
  markPostingRecordsUnrelated: (applicationIds: string[]) => Promise<boolean>;
  resolvePreparationDuplicate: () => Promise<DuplicateResolution>;
  onDraftCreated: (applicationId: string) => void;
};

// Owns the Application Questions tab: drafting answers/role descriptions via the
// AI provider seam and saving them onto a pipeline entry. Self-contained except
// for the AI request fields, the current job target, and the applications store
// helpers, which are passed in.
export function useApplicationAnswers({
  resumeText,
  resumeData,
  jobDescription,
  applicationJobDescription,
  applicationRawJobDescription,
  applicationTracking,
  linkedApplication,
  jobUrl,
  honestContext,
  customInstructions,
  aiRequest,
  providerReady,
  providerMessage,
  preparationSession,
  hasLoadedApplications,
  createApplication,
  updateApplicationById,
  linkPostingRecords,
  markPostingRecordsUnrelated,
  resolvePreparationDuplicate,
  onDraftCreated
}: UseApplicationAnswersArgs) {
  const [answersResult, setAnswersResult] = useState<ApplicationAnswersResult>(null);
  const [answersStatus, setAnswersStatus] = useState("");
  const [isGeneratingAnswers, setIsGeneratingAnswers] = useState(false);
  // Dock card mirroring the polish/job-analysis progress cards. Unlike the cover
  // letter and job-analysis flows, there is NO local fallback for answers — a
  // failed generation stays "failed" (with Retry) rather than being
  // re-presented as a done-with-warning card.
  const [answersProgress, setAnswersProgress] = useState<StageState>({ status: "idle" });

  const dismissAnswersProgress = () => setAnswersProgress({ status: "idle" });

  function stopAnswers() {
    if (!requestAbortRef.current) return;
    requestGenerationRef.current += 1;
    requestAbortRef.current.abort();
    requestAbortRef.current = null;
    setIsGeneratingAnswers(false);
    setAnswersStatus("Application answer drafting stopped. Existing drafts were kept.");
    setAnswersProgress({
      status: "stopped",
      errorHeadline: "Stopped",
      error: "Answer drafting was cancelled. Generate drafts again when you are ready."
    });
  }

  // Last submitted request, so the failed dock card's Retry can replay it —
  // handleGenerateAnswers needs the questions list, which only MaterialsTab
  // holds at click time. A ref (not state): nothing renders from it.
  const lastRequestRef = useRef<{ questions: string[]; includeRoleDescriptions: boolean } | null>(null);
  const requestGenerationRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const answerSaveInFlightRef = useRef(false);
  const preparationSessionRef = useRef(preparationSession);
  preparationSessionRef.current = preparationSession;
  const answerSaveContext = [
    preparationSession.mode,
    preparationSession.applicationId ?? "",
    jobUrl.trim(),
    applicationJobDescription,
    applicationRawJobDescription,
    JSON.stringify(applicationTracking)
  ].join("\u0000");
  const answerSaveContextRef = useRef(answerSaveContext);
  answerSaveContextRef.current = answerSaveContext;
  const inputFingerprint = workflowInputFingerprint({
    resumeText,
    resumeData,
    jobDescription,
    jobUrl,
    honestContext,
    customInstructions,
    aiRequest: buildStageRequestFields(aiRequest)
  });
  const inputFingerprintRef = useRef(inputFingerprint);
  inputFingerprintRef.current = inputFingerprint;
  const contentFingerprint = workflowInputFingerprint({ resumeText, resumeData, jobDescription, jobUrl });
  const previousContentFingerprintRef = useRef(contentFingerprint);

  // Any request-input change invalidates only an IN-FLIGHT generation. Completed
  // output may already contain user edits in MaterialsTab, so settings/provider
  // changes must never clear it.
  useEffect(() => {
    const hadActiveRequest = requestAbortRef.current !== null;
    requestGenerationRef.current += 1;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    setIsGeneratingAnswers(false);
    if (hadActiveRequest) {
      setAnswersStatus("Resume, job, or AI settings changed. The in-flight answer request was cancelled.");
      setAnswersProgress({
        status: "stopped",
        errorHeadline: "Inputs changed",
        error: "Generate again when the current resume, job, and AI settings are ready."
      });
    }
  }, [inputFingerprint]);

  // Resume/job changes make a completed draft stale, but preserving it is safer
  // than erasing user-edited answers. The next explicit Generate replaces it.
  useEffect(() => {
    if (previousContentFingerprintRef.current === contentFingerprint) return;
    previousContentFingerprintRef.current = contentFingerprint;
    if (!answersResult) return;
    setAnswersStatus("Resume or job changed. Existing answer drafts were kept; review them or generate a fresh set.");
    setAnswersProgress({
      status: "stopped",
      errorHeadline: "Draft inputs changed",
      error: "Existing drafts are preserved for review and may no longer match the current resume or job."
    });
  }, [answersResult, contentFingerprint]);

  useEffect(() => () => {
    requestGenerationRef.current += 1;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
  }, []);

  async function handleGenerateAnswers({
    questions,
    includeRoleDescriptions
  }: {
    questions: string[];
    includeRoleDescriptions: boolean;
  }) {
    requestGenerationRef.current += 1;
    const generation = requestGenerationRef.current;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    setIsGeneratingAnswers(false);
    const submittedQuestions = [...questions];
    lastRequestRef.current = { questions: submittedQuestions, includeRoleDescriptions };
    if (!providerReady) {
      setAnswersStatus(providerMessage);
      setAnswersProgress({
        status: "failed",
        errorHeadline: "Provider unavailable",
        error: providerMessage
      });
      return;
    }
    const roleEvidence = includeRoleDescriptions ? buildApplicationRoleEvidence(resumeData) : [];
    if (includeRoleDescriptions && !roleEvidence.length) {
      setAnswersStatus("No structured work-experience roles with bullets are available to describe.");
      setAnswersProgress({
        status: "failed",
        errorHeadline: "No work roles found",
        error: "Add a bulleted Experience or Employment section, or turn off role descriptions."
      });
      return;
    }
    setIsGeneratingAnswers(true);
    setAnswersStatus("Drafting application answers...");
    setAnswersProgress({ status: "running" });
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const requestFingerprint = inputFingerprintRef.current;
    const isCurrent = () => workflowRequestIsCurrent(
      generation,
      requestGenerationRef.current,
      requestFingerprint,
      inputFingerprintRef.current,
      controller.signal
    );
    try {
      const response = await fetch("/api/application-answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildStageRequestFields(aiRequest),
          resumeText,
          jobText: jobDescription,
          honestContext,
          customInstructions,
          questions: submittedQuestions,
          includeRoleDescriptions,
          roleEvidence
        }),
        signal: controller.signal
      });
      const data = await response.json();
      if (!isCurrent()) return;
      if (!response.ok) throw new ApiError(data.error ?? "Could not generate answers.", response.status);
      setAnswersResult({
        answers: Array.isArray(data.answers) ? data.answers : [],
        roleDescriptions: Array.isArray(data.roleDescriptions) ? data.roleDescriptions : []
      });
      const count = Array.isArray(data.answers) ? data.answers.length : 0;
      setAnswersStatus(
        `Drafted ${count} answer${count === 1 ? "" : "s"}${data.model ? ` using ${data.model}` : ""}. Fill in any [add: …] placeholders before sending.`
      );
      setAnswersProgress({ status: "done", note: `${count} answer${count === 1 ? "" : "s"} drafted`, noteTone: "ok" });
    } catch (error) {
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message.replace(/[.。]\s*$/, "") : "request failed";
      setAnswersStatus(`Could not generate answers: ${message}.`);
      const f = classifyFailure(error);
      setAnswersProgress({ status: "failed", errorHeadline: f.headline, error: f.detail });
    } finally {
      if (isCurrent()) {
        requestAbortRef.current = null;
        setIsGeneratingAnswers(false);
      }
    }
  }

  // Replay the last generation request from the failed dock card's Retry.
  // No-op if nothing was ever submitted (the card can't exist then anyway).
  function retryAnswers() {
    if (!lastRequestRef.current || isGeneratingAnswers) return;
    void handleGenerateAnswers(lastRequestRef.current);
  }

  async function handleSaveAnswers(items: { question: string; answer: string }[]) {
    if (!items.length || answerSaveInFlightRef.current) return;
    if (!jobUrl.trim() && !jobDescription.trim()) {
      setAnswersStatus("Prepare a job on Prepare before saving answers to the pipeline.");
      return;
    }
    answerSaveInFlightRef.current = true;
    try {
      const session = preparationSession;
      const now = new Date().toISOString();
      const saved = items.map((it) => ({ question: it.question, answer: it.answer, savedAt: now }));
      if (session.mode !== "new") {
        const commit = applicationAnswerCommit({
          session,
          existing: linkedApplication,
          draft: null,
          answers: saved
        });
        if (!commit) {
          setAnswersStatus(
            "Could not save answers because the selected pipeline record is no longer available. Reopen the preparation and retry."
          );
          return;
        }
        const didSave = await updateApplicationById(commit.application).catch(() => false);
        setAnswersStatus(didSave
          ? `Saved ${saved.length} answer${saved.length === 1 ? "" : "s"} to "${commit.application.title}" in the pipeline.`
          : "Could not save answers because the pipeline changed or storage was unavailable. Review the latest entry and retry.");
        return;
      }

      if (!hasLoadedApplications) {
        setAnswersStatus("Wait for Applications to finish loading before saving answers.");
        return;
      }
      const capturedSaveContext = answerSaveContext;
      let resolution: DuplicateResolution;
      try {
        resolution = await resolvePreparationDuplicate();
      } catch {
        setAnswersStatus("Duplicate checking failed, so the answers were not saved. Retry Save selected.");
        return;
      }
      if (resolution.action !== "continue") return;
      if (
        preparationSessionRef.current.mode !== "new"
        || answerSaveContextRef.current !== capturedSaveContext
      ) {
        setAnswersStatus("The preparation changed while duplicate review was open. Review the current job and save again.");
        return;
      }

      const draft: Application = {
        ...makeApplicationDraft(jobUrl, applicationJobDescription, applicationTracking),
        rawJobDescription: applicationRawJobDescription.trim()
      };
      const commit = applicationAnswerCommit({
        session,
        existing: null,
        draft,
        answers: saved
      });
      if (!commit) return;
      const app = commit.application;
      const didSave = await createApplication(app).catch(() => false);
      if (!didSave) {
        setAnswersStatus(
          "Could not save answers because the pipeline changed or storage was unavailable. Review the latest entries and retry."
        );
        return;
      }

      let relationshipWarning = "";
      if (resolution.relationship) {
        const linked = await linkPostingRecords(
          [app.id, resolution.relationship.matchedApplicationId],
          resolution.relationship.jobPostingGroupId
        ).catch(() => null);
        if (!linked) relationshipWarning = " The related posting could not be linked; both records remain separate.";
      } else if (resolution.unrelatedApplicationId) {
        const separated = await markPostingRecordsUnrelated([
          app.id,
          resolution.unrelatedApplicationId
        ]).catch(() => false);
        if (!separated) {
          relationshipWarning = " The Keep separate decision could not be saved; the records may appear in duplicate review.";
        }
      }
      onDraftCreated(app.id);
      setAnswersStatus(
        `Saved ${saved.length} answer${saved.length === 1 ? "" : "s"} to a new pipeline draft, "${app.title}".${relationshipWarning}`
      );
    } finally {
      answerSaveInFlightRef.current = false;
    }
  }

  return {
    answersResult,
    answersStatus,
    isGeneratingAnswers,
    handleGenerateAnswers,
    handleSaveAnswers,
    answersProgress,
    dismissAnswersProgress,
    stopAnswers,
    retryAnswers
  };
}
