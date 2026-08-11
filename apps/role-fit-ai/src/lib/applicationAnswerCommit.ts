import type {
  Application,
  ApplicationAnswer
} from "../hooks/useApplications.ts";
import type { PreparationSession } from "./preparationSession.ts";

export type ApplicationAnswerCommit = {
  operation: "create" | "update";
  application: Application;
};

export function applicationAnswerCommit({
  session,
  existing,
  draft,
  answers
}: {
  session: PreparationSession;
  existing: Application | null;
  draft: Application | null;
  answers: ApplicationAnswer[];
}): ApplicationAnswerCommit | null {
  if (session.mode === "new") {
    if (!draft) return null;
    return {
      operation: "create",
      application: { ...draft, applicationAnswers: answers }
    };
  }
  if (!existing || existing.id !== session.applicationId) return null;

  const byQuestion = new Map<string, ApplicationAnswer>();
  for (const answer of existing.applicationAnswers ?? []) {
    byQuestion.set(answer.question, answer);
  }
  for (const answer of answers) byQuestion.set(answer.question, answer);
  return {
    operation: "update",
    application: {
      ...existing,
      applicationAnswers: Array.from(byQuestion.values())
    }
  };
}
