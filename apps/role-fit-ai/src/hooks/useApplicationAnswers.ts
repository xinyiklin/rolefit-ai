import { useEffect, useRef, useState } from "react";
import { buildStageRequestFields, type StageConfig } from "../lib/aiRequest";
import { classifyFailure, ApiError } from "../lib/failures";
import type { ApplicationAnswersResult } from "../sections/shared";
import type { StageState } from "../sections/PolishProgress";
import { makeApplicationDraft, type Application } from "./useApplications";

type UseApplicationAnswersArgs = {
  resumeText: string;
  jobDescription: string;
  jobUrl: string;
  honestContext: string;
  customInstructions: string;
  aiRequest: StageConfig;
  upsertApplication: (app: Application) => void;
  findForTarget: (url: string, desc: string) => Application | undefined;
};

// Owns the Application Questions tab: drafting answers/role descriptions via the
// AI provider seam and saving them onto a pipeline entry. Self-contained except
// for the AI request fields, the current job target, and the applications store
// helpers, which are passed in.
export function useApplicationAnswers({
  resumeText,
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

  // Drafts are tied to the current resume + job; clear them (and the tab badge)
  // when either changes — mirrors how the polish result resets on input change.
  // The dock card and its replayable request die with the inputs they belonged
  // to: a stale failed card's Retry would otherwise replay the OLD questions
  // against the NEW resume/job.
  useEffect(() => {
    setAnswersResult(null);
    setAnswersStatus("");
    setAnswersProgress({ status: "idle" });
    lastRequestRef.current = null;
  }, [resumeText, jobDescription]);

  async function handleGenerateAnswers({
    questions,
    includeRoleDescriptions
  }: {
    questions: string[];
    includeRoleDescriptions: boolean;
  }) {
    lastRequestRef.current = { questions, includeRoleDescriptions };
    setIsGeneratingAnswers(true);
    setAnswersStatus("Drafting application answers...");
    setAnswersProgress({ status: "running" });
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
          questions,
          includeRoleDescriptions
        })
      });
      const data = await response.json();
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
      const message = error instanceof Error ? error.message.replace(/[.。]\s*$/, "") : "request failed";
      setAnswersStatus(`Could not generate answers: ${message}.`);
      const f = classifyFailure(error);
      setAnswersProgress({ status: "failed", errorHeadline: f.headline, error: f.detail });
    } finally {
      setIsGeneratingAnswers(false);
    }
  }

  // Replay the last generation request from the failed dock card's Retry.
  // No-op if nothing was ever submitted (the card can't exist then anyway).
  function retryAnswers() {
    if (!lastRequestRef.current || isGeneratingAnswers) return;
    void handleGenerateAnswers(lastRequestRef.current);
  }

  function handleSaveAnswers(items: { question: string; answer: string }[]) {
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
      upsertApplication({ ...existing, applicationAnswers: Array.from(byQuestion.values()) });
      setAnswersStatus(`Saved ${saved.length} answer${saved.length === 1 ? "" : "s"} to "${existing.title}" in the pipeline.`);
      return;
    }
    const app: Application = {
      ...makeApplicationDraft(jobUrl, jobDescription),
      applicationAnswers: saved
    };
    upsertApplication(app);
    setAnswersStatus(`Saved ${saved.length} answer${saved.length === 1 ? "" : "s"} to a new pipeline entry, "${app.title}".`);
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
