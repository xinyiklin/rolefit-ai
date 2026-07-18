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

type UseApplicationAnswersArgs = {
  resumeText: string;
  resumeData: ResumeData | null;
  jobDescription: string;
  jobUrl: string;
  honestContext: string;
  customInstructions: string;
  aiRequest: StageConfig;
  upsertApplication: (app: Application) => Promise<boolean>;
  findForTarget: (url: string, desc: string) => Application | undefined;
};

// Owns the Application Questions tab: drafting answers/role descriptions via the
// AI provider seam and saving them onto a pipeline entry. Self-contained except
// for the AI request fields, the current job target, and the applications store
// helpers, which are passed in.
export function useApplicationAnswers({
  resumeText,
  resumeData,
  jobDescription,
  jobUrl,
  honestContext,
  customInstructions,
  aiRequest,
  upsertApplication,
  findForTarget
}: UseApplicationAnswersArgs) {
  const [answersResult, setAnswersResult] = useState<ApplicationAnswersResult>(null);
  const [answersStatus, setAnswersStatus] = useState("");
  const [isGeneratingAnswers, setIsGeneratingAnswers] = useState(false);
  // Dock card mirroring the polish/distill progress cards. Unlike the cover
  // letter and distill flows, there is NO local fallback for answers — a
  // failed generation stays "failed" (with Retry) rather than being
  // re-presented as a done-with-warning card.
  const [answersProgress, setAnswersProgress] = useState<StageState>({ status: "idle" });

  const dismissAnswersProgress = () => setAnswersProgress({ status: "idle" });

  // Last submitted request, so the failed dock card's Retry can replay it —
  // handleGenerateAnswers needs the questions list, which only MaterialsTab
  // holds at click time. A ref (not state): nothing renders from it.
  const lastRequestRef = useRef<{ questions: string[]; includeRoleDescriptions: boolean } | null>(null);
  const requestGenerationRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
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
    if (!items.length) return;
    if (!jobUrl.trim() && !jobDescription.trim()) {
      setAnswersStatus("Add a job link or description before saving answers to the pipeline.");
      return;
    }
    const now = new Date().toISOString();
    const saved = items.map((it) => ({ question: it.question, answer: it.answer, savedAt: now }));
    const existing = findForTarget(jobUrl, jobDescription);
    if (existing) {
      const byQuestion = new Map<string, { question: string; answer: string; savedAt: string }>();
      for (const a of existing.applicationAnswers ?? []) byQuestion.set(a.question, a);
      for (const a of saved) byQuestion.set(a.question, a);
      const didSave = await upsertApplication({ ...existing, applicationAnswers: Array.from(byQuestion.values()) });
      setAnswersStatus(didSave
        ? `Saved ${saved.length} answer${saved.length === 1 ? "" : "s"} to "${existing.title}" in the pipeline.`
        : "Could not save answers because the pipeline changed or storage was unavailable. Review the latest entry and retry.");
      return;
    }
    const app: Application = {
      ...makeApplicationDraft(jobUrl, jobDescription),
      applicationAnswers: saved
    };
    const didSave = await upsertApplication(app);
    setAnswersStatus(didSave
      ? `Saved ${saved.length} answer${saved.length === 1 ? "" : "s"} to a new pipeline entry, "${app.title}".`
      : "Could not save answers because the pipeline changed or storage was unavailable. Review the latest entries and retry.");
  }

  return {
    answersResult,
    answersStatus,
    isGeneratingAnswers,
    handleGenerateAnswers,
    handleSaveAnswers,
    answersProgress,
    dismissAnswersProgress,
    retryAnswers
  };
}
