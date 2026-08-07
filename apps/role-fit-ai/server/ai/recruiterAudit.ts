import { FetchTimeoutError } from "../http.ts";
import { UserSafeAiError, safeConfigErrorMessage } from "./errors.ts";
import { callConfiguredProvider } from "./clients.ts";
import { providerLabel, type ResolvedProviderConfig } from "./providers.ts";
import {
  parseModelFitAssessmentEnvelope,
  parseModelSubmissionAssessmentEnvelope,
  type AssessmentIssue,
  type AssessmentResult
} from "./assessmentModelOutput.ts";
import {
  buildFitAssessmentPrompts,
  buildSubmissionAssessmentPrompts,
  ASSESSMENT_JOB_CHAR_LIMIT,
  ASSESSMENT_RESUME_CHAR_LIMIT,
  clipForPrompt
} from "./prompts.ts";
import {
  validateFitAssessment,
  validateSubmissionAssessment
} from "./fitAssessmentValidation.ts";
import type {
  FitAssessment,
  SubmissionAssessment
} from "../../shared/fitAssessmentContract.ts";

export type AttemptStats = { attempts?: number };

export type AssessmentRunResult<T> =
  | { status: "ok"; assessment: T }
  | { status: "invalid"; issue: AssessmentIssue };

export type RecruiterAuditOutcome = AssessmentRunResult<SubmissionAssessment>;

export type InitialFitAuditOutcome = AssessmentRunResult<FitAssessment>;

type ReviewFailure = { message: string; status: number };

function assessmentRunResult<T>(result: AssessmentResult<T>): AssessmentRunResult<T> {
  return result.ok
    ? { status: "ok", assessment: result.value }
    : { status: "invalid", issue: result.issue };
}

/** Preserve actionable provider failures without exposing raw provider bodies. */
export function reviewFailureFromReason(reason: unknown, provider: string): ReviewFailure {
  if (reason instanceof UserSafeAiError) {
    return { message: reason.message, status: reason.status };
  }
  if (reason instanceof FetchTimeoutError || (reason instanceof Error && /timed out|timeout/i.test(reason.message))) {
    return {
      message: `${providerLabel(provider)} timed out before finishing the review. Try again or switch providers.`,
      status: 504
    };
  }
  const configMessage = safeConfigErrorMessage(reason instanceof Error ? reason.message : "");
  if (configMessage) return { message: configMessage, status: 400 };
  return {
    message: `${providerLabel(provider)} did not return a usable review. Try again or switch providers.`,
    status: 502
  };
}

export function resolveReviewOutcome(
  parsed: unknown,
  jobText: string,
  resumeText: string,
  honestContext: string
): RecruiterAuditOutcome {
  const modelOutput = parseModelSubmissionAssessmentEnvelope(parsed);
  if (!modelOutput.ok) return { status: "invalid", issue: modelOutput.issue };
  return assessmentRunResult(validateSubmissionAssessment(
    modelOutput.value,
    jobText,
    resumeText,
    honestContext
  ));
}

export function resolveInitialFitAuditOutcome(
  parsed: unknown,
  jobText: string,
  resumeText: string,
  honestContext: string
): InitialFitAuditOutcome {
  const modelOutput = parseModelFitAssessmentEnvelope(parsed);
  if (!modelOutput.ok) return { status: "invalid", issue: modelOutput.issue };
  return assessmentRunResult(validateFitAssessment(
    modelOutput.value,
    jobText,
    resumeText,
    honestContext
  ));
}

type RecruiterAuditRequest = {
  mode: "comparison" | "initial";
  provider: ResolvedProviderConfig;
  jobText: string;
  resumeText: string;
  honestContext: string;
  customInstructions: string;
  signal: AbortSignal;
};

export async function runRecruiterAudit(
  request: RecruiterAuditRequest & { mode: "comparison" },
  stats?: AttemptStats
): Promise<RecruiterAuditOutcome>;
export async function runRecruiterAudit(
  request: RecruiterAuditRequest & { mode: "initial" },
  stats?: AttemptStats
): Promise<InitialFitAuditOutcome>;
export async function runRecruiterAudit(
  request: RecruiterAuditRequest,
  stats?: AttemptStats
): Promise<RecruiterAuditOutcome | InitialFitAuditOutcome> {
  const promptInput = {
    jobText: clipForPrompt(request.jobText, ASSESSMENT_JOB_CHAR_LIMIT, "job description"),
    resumeText: clipForPrompt(request.resumeText, ASSESSMENT_RESUME_CHAR_LIMIT, "reviewed resume"),
    honestContext: request.honestContext,
    customInstructions: request.customInstructions
  };
  const prompts = request.mode === "initial"
    ? buildFitAssessmentPrompts(promptInput)
    : buildSubmissionAssessmentPrompts(promptInput);
  const parsed: unknown = await callConfiguredProvider({
    provider: request.provider.provider,
    model: request.provider.model,
    reasoningEffort: request.provider.reasoningEffort,
    apiKey: request.provider.apiKey,
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt,
    signal: request.signal
  }, stats);

  return request.mode === "initial"
    ? resolveInitialFitAuditOutcome(parsed, request.jobText, request.resumeText, request.honestContext)
    : resolveReviewOutcome(parsed, request.jobText, request.resumeText, request.honestContext);
}
