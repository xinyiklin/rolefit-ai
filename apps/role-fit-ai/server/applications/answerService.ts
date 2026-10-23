// Application answers written by a caller outside the browser: stamped for the
// record they belong to, then appended to a saved record under the tracker
// lock. Saved revisions are never rewritten (reconcile enforces it).

import {
  MAX_SAVED_ANSWERS_CHARS,
  MAX_SAVED_ANSWER_REVISIONS,
  answerReceiptIsCurrent,
  parseSavedApplicationAnswers
} from "../../shared/applicationAnswerStorage.ts";
import { reconcileApplicationMutations } from "./reconcile.ts";
import { nextApplicationRevision } from "./routeSupport.ts";
import { ApplicationsStorageError, isCanonicalApplicationTimestamp, sanitizeApplications } from "./schema.ts";
import {
  readApplicationsSnapshot,
  withApplicationsLock,
  writeApplicationsSnapshot
} from "./storage.ts";

export const MAX_APPENDED_ANSWERS = 40;

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

// A full answer revision names the record it belongs to; a plain
// question/answer pair does not. Either may omit savedAt.
export function answerForRecord(answer: unknown, applicationId: string, now: string) {
  if (!isObject(answer)) return answer;
  const plainPair = Object.keys(answer).every((key) => key === "question" || key === "answer" || key === "savedAt");
  return {
    ...answer,
    ...(plainPair ? {} : { applicationId }),
    savedAt: answer.savedAt === undefined ? now : answer.savedAt
  };
}

// Why each stamped answer would be refused, named by its path. Reconcile checks
// the same receipt, and the stored list check accepts any savedAt text on a
// plain pair; checking here names the answer and keeps outside writes dated.
export function answerIssues(answers: readonly unknown[], applicationId: string, path: string): string[] {
  return answers.flatMap((answer, index) => {
    const at = `${path}[${index}]`;
    const parsed = parseSavedApplicationAnswers([answer], applicationId)?.[0];
    if (!parsed) return [`${at}: not a valid answer`];
    if (!isCanonicalApplicationTimestamp(parsed.savedAt)) return [`${at}.savedAt: must be a canonical ISO timestamp`];
    return parsed.id && parsed.constraints && parsed.counts && parsed.compliant !== undefined
      && !answerReceiptIsCurrent(parsed as Parameters<typeof answerReceiptIsCurrent>[0])
      ? [`${at}: its counts or limits do not match its text; send a plain {question, answer} pair instead`]
      : [];
  });
}

export class ApplicationAnswersError extends ApplicationsStorageError {
  issues: string[];
  constructor(issues: string[]) {
    super("No answers were saved. Fix the listed answers and try again.", 400);
    this.name = "ApplicationAnswersError";
    this.issues = issues;
  }
}

const APPEND_KEYS = ["answers", "baseUpdatedAt"];

export async function appendApplicationAnswers(workspaceDir: string, id: string, body: unknown) {
  if (!isObject(body)) throw new ApplicationAnswersError(["body: send a JSON object with answers"]);
  const unknownKey = Object.keys(body).find((key) => !APPEND_KEYS.includes(key));
  if (unknownKey) throw new ApplicationAnswersError([`${unknownKey}: not an answers field (send answers, baseUpdatedAt)`]);
  const { answers, baseUpdatedAt } = body;
  if (!Array.isArray(answers) || answers.length === 0 || answers.length > MAX_APPENDED_ANSWERS) {
    throw new ApplicationAnswersError([`answers: send 1 to ${MAX_APPENDED_ANSWERS} answers`]);
  }
  if (baseUpdatedAt !== undefined && (typeof baseUpdatedAt !== "string" || baseUpdatedAt.length > 100)) {
    throw new ApplicationAnswersError(["baseUpdatedAt: must be the record's updatedAt when given"]);
  }

  return withApplicationsLock(async () => {
    const snapshot = await readApplicationsSnapshot(workspaceDir);
    const current = snapshot.applications.find((application) => application.id === id);
    if (!current) throw new ApplicationsStorageError("Application not found.", 404);
    if (baseUpdatedAt !== undefined && baseUpdatedAt !== current.updatedAt) {
      throw new ApplicationsStorageError(
        "This application changed since it was read. Review the current record before adding answers.",
        409,
        [current]
      );
    }
    const updatedAt = nextApplicationRevision(current.updatedAt);
    const added = answers.map((answer) => answerForRecord(answer, id, updatedAt));
    // Each answer alone first, so a refusal names the one at fault.
    const issues = answerIssues(added, id, "answers");
    if (issues.length) throw new ApplicationAnswersError(issues);
    // Answers are stored exactly as parsed, so the list check is the whole check.
    const applicationAnswers = [...(current.applicationAnswers ?? []), ...added];
    if (parseSavedApplicationAnswers(applicationAnswers, id) === null) {
      throw new ApplicationAnswersError([
        `answers: with the saved answers, this exceeds ${MAX_SAVED_ANSWER_REVISIONS} answers or ${MAX_SAVED_ANSWERS_CHARS} characters, ` +
          "or repeats a revision id or a question id with different text"
      ]);
    }
    const next = { ...current, applicationAnswers, updatedAt };
    const reconciled = reconcileApplicationMutations(
      snapshot.applications,
      sanitizeApplications([next]),
      [{ id, operation: "upsert", baseUpdatedAt: current.updatedAt }]
    );
    const written = await writeApplicationsSnapshot(workspaceDir, reconciled);
    return {
      application: written.applications.find((application) => application.id === id),
      revision: written.revision,
      added: added.length
    };
  });
}
