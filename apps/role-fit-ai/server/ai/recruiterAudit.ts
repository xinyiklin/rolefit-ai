import { FetchTimeoutError } from "../http.ts";
import { UserSafeAiError, safeConfigErrorMessage } from "./errors.ts";
import { callConfiguredProvider } from "./clients.ts";
import { providerLabel, type ResolvedProviderConfig } from "./providers.ts";
import {
  STRICT_REVIEW_JOB_CHAR_LIMIT,
  STRICT_REVIEW_RESUME_CHAR_LIMIT,
  buildStrictReviewPrompts,
  clipForPrompt
} from "./prompts.ts";
import {
  sanitizeAiFitScore,
  sanitizeStrictReview
} from "./sanitize.ts";

export type AttemptStats = { attempts?: number };

export type RecruiterAuditOutcome = {
  strictReview: ReturnType<typeof sanitizeStrictReview>;
  aiScore: ReturnType<typeof sanitizeAiFitScore>;
};

export type InitialFitAuditOutcome = {
  review: NonNullable<ReturnType<typeof sanitizeStrictReview>>;
  score: number;
} | null;

type ReviewFailure = { message: string; status: number };

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

// Compose the model-authored review and score into one all-or-nothing outcome.
// AI Review owns the judgment; the server validates shape, grounding, numeric
// bounds, and score/verdict consistency without repairing either half.
export function resolveReviewOutcome(
  reviewParsed: { strictReview?: unknown; aiScore?: unknown } | null,
  jobText: string,
  groundingText: string,
  options: Parameters<typeof sanitizeStrictReview>[3] = {}
): RecruiterAuditOutcome {
  let strictReview = reviewParsed
    ? sanitizeStrictReview(reviewParsed.strictReview, jobText, groundingText, options)
    : null;
  if (strictReview && (!strictReview.coverage.length || !strictReview.verdictReason.trim())) {
    strictReview = null;
  }
  const aiScore = strictReview
    ? sanitizeAiFitScore(reviewParsed?.aiScore, strictReview.verdict)
    : null;
  return strictReview && aiScore
    ? { strictReview, aiScore }
    : { strictReview: null, aiScore: null };
}

// Initial Fit audits exactly one unchanged document. The shared Recruiter Audit
// prompt still emits its legacy pair internally, but unequal values would imply
// a before/after comparison that does not exist and therefore fail closed.
export function resolveInitialFitAuditOutcome(
  reviewParsed: { strictReview?: unknown; aiScore?: unknown } | null,
  jobText: string,
  groundingText: string
): InitialFitAuditOutcome {
  const outcome = resolveReviewOutcome(reviewParsed, jobText, groundingText);
  if (!outcome.strictReview || !outcome.aiScore) return null;
  if (outcome.aiScore.base !== outcome.aiScore.tailored) return null;
  return {
    review: outcome.strictReview,
    score: outcome.aiScore.tailored
  };
}

type RecruiterAuditRequest = {
  mode: "comparison" | "initial";
  provider: ResolvedProviderConfig;
  jobText: string;
  resumeText: string;
  suggestedChanges: unknown;
  honestContext: string;
  customInstructions: string;
  signal: AbortSignal;
  groundingText?: string;
  sanitizeOptions?: Parameters<typeof sanitizeStrictReview>[3];
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
  const prompts = buildStrictReviewPrompts({
    jobText: clipForPrompt(request.jobText, STRICT_REVIEW_JOB_CHAR_LIMIT, "job description"),
    resumeText: clipForPrompt(request.resumeText, STRICT_REVIEW_RESUME_CHAR_LIMIT, "reviewed resume"),
    suggestedChanges: request.suggestedChanges,
    honestContext: request.honestContext,
    customInstructions: request.customInstructions
  });
  const parsed = await callConfiguredProvider({
    provider: request.provider.provider,
    model: request.provider.model,
    reasoningEffort: request.provider.reasoningEffort,
    apiKey: request.provider.apiKey,
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt,
    signal: request.signal
  }, stats) as { strictReview?: unknown; aiScore?: unknown } | null;

  return request.mode === "initial"
    ? resolveInitialFitAuditOutcome(parsed, request.jobText, `${request.resumeText}\n${request.honestContext}`)
    : resolveReviewOutcome(
        parsed,
        request.jobText,
        request.groundingText ?? `${request.resumeText}\n${request.honestContext}`,
        request.sanitizeOptions
      );
}
