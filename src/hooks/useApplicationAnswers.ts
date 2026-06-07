import { useEffect, useState } from "react";
import { buildAiRequestFields, type AiRequestSettings } from "../lib/aiRequest";
import type { ApplicationAnswersResult } from "../sections/shared";
import { makeApplicationDraft, type Application } from "./useApplications";

type UseApplicationAnswersArgs = {
  resumeText: string;
  jobDescription: string;
  jobUrl: string;
  honestContext: string;
  customInstructions: string;
  aiRequest: AiRequestSettings;
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

  // Drafts are tied to the current resume + job; clear them (and the tab badge)
  // when either changes — mirrors how the polish result resets on input change.
  useEffect(() => {
    setAnswersResult(null);
    setAnswersStatus("");
  }, [resumeText, jobDescription]);

  async function handleGenerateAnswers({
    questions,
    includeRoleDescriptions
  }: {
    questions: string[];
    includeRoleDescriptions: boolean;
  }) {
    setIsGeneratingAnswers(true);
    setAnswersStatus("Drafting application answers...");
    try {
      const response = await fetch("/api/application-answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildAiRequestFields(aiRequest),
          resumeText,
          jobText: jobDescription,
          honestContext,
          customInstructions,
          questions,
          includeRoleDescriptions
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not generate answers.");
      setAnswersResult({
        answers: Array.isArray(data.answers) ? data.answers : [],
        roleDescriptions: Array.isArray(data.roleDescriptions) ? data.roleDescriptions : []
      });
      const count = Array.isArray(data.answers) ? data.answers.length : 0;
      setAnswersStatus(
        `Drafted ${count} answer${count === 1 ? "" : "s"}${data.model ? ` using ${data.model}` : ""}. Fill in any [add: …] placeholders before sending.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/[.。]\s*$/, "") : "request failed";
      setAnswersStatus(`Could not generate answers: ${message}.`);
    } finally {
      setIsGeneratingAnswers(false);
    }
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

  return { answersResult, answersStatus, isGeneratingAnswers, handleGenerateAnswers, handleSaveAnswers };
}
