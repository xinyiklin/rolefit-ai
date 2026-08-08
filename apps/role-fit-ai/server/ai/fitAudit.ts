import type { IncomingMessage, ServerResponse } from "node:http";

import { buildInitialFitAuditFingerprint } from "../../shared/initialFitAuditContract.ts";
import {
  FetchTimeoutError,
  isRequestAborted,
  requestAbortSignal,
  sendJson
} from "../http.ts";
import { UserSafeAiError } from "./errors.ts";
import { readAiJsonBody } from "./json.ts";
import { providerLabel, resolveReviewOnlyProviderRequest } from "./providers.ts";
import {
  STRICT_REVIEW_JOB_CHAR_LIMIT,
  STRICT_REVIEW_RESUME_CHAR_LIMIT
} from "./prompts.ts";
import {
  reviewFailureFromReason,
  runRecruiterAudit,
  type AttemptStats
} from "./recruiterAudit.ts";

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.length > max) return null;
  return value;
}

function validIdentity(value: string, max: number): boolean {
  return value.length > 0 && value.length <= max && !/[\u0000-\u001f/\\]/.test(value);
}

export async function handleFitAudit(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  let provider = "claude-cli";
  const request = requestAbortSignal(req, res);
  try {
    const body = await readAiJsonBody(req, 1_000_000);
    const preparationId = boundedString(body.preparationId, 120) ?? "";
    const resumeFileName = boundedString(body.resumeFileName, 240) ?? "";
    const resumeDocumentVersion = boundedString(body.resumeDocumentVersion, 240) ?? "";
    const jobText = boundedString(body.jobText, STRICT_REVIEW_JOB_CHAR_LIMIT);
    const resumeText = boundedString(body.resumeText, STRICT_REVIEW_RESUME_CHAR_LIMIT);
    const honestContext = boundedString(body.honestContext ?? "", 8_000);
    const customInstructions = boundedString(body.customInstructions ?? "", 4_000);

    if (
      !validIdentity(preparationId, 120) ||
      !validIdentity(resumeFileName, 240) ||
      !validIdentity(resumeDocumentVersion, 240)
    ) {
      sendJson(res, 400, { error: "The prepared job or selected resume identity is invalid. Prepare the job again." });
      return;
    }
    if (jobText === null || resumeText === null || honestContext === null || customInstructions === null) {
      sendJson(res, 413, { error: "Initial Fit inputs are too large. Shorten the job, resume, or guidance and try again." });
      return;
    }
    if (jobText.trim().length < 40 || resumeText.trim().length < 40) {
      sendJson(res, 400, { error: "Prepare a job and select a resume with enough evidence before running Initial Fit." });
      return;
    }

    const resolved = resolveReviewOnlyProviderRequest(body);
    provider = resolved.provider;
    const fingerprint = buildInitialFitAuditFingerprint({
      preparationId,
      jobText,
      resumeFileName,
      resumeDocumentVersion,
      resumeText,
      honestContext,
      provider: resolved.provider,
      model: resolved.model,
      reasoningEffort: resolved.reasoningEffort,
      instructions: customInstructions
    });
    const stats: AttemptStats = {};
    const outcome = await runRecruiterAudit({
      mode: "initial",
      provider: resolved,
      jobText,
      resumeText,
      suggestedChanges: [],
      honestContext,
      customInstructions,
      signal: request.signal
    }, stats);
    if (!outcome) {
      sendJson(res, 502, {
        error: `${providerLabel(provider)} returned an invalid Initial Fit audit. Retry, or switch providers.`
      });
      return;
    }

    const completedAt = new Date().toISOString();
    sendJson(res, 200, {
      preparationId,
      fingerprint,
      resumeFileName,
      resumeDocumentVersion,
      score: outcome.score,
      verdict: outcome.review.verdict,
      verdictReason: outcome.review.verdictReason,
      review: outcome.review,
      completedAt,
      usage: {
        source: "ai",
        provider: resolved.provider,
        model: resolved.model,
        reasoningEffort: resolved.reasoningEffort,
        attempts: stats.attempts ?? 1,
        completedAt
      }
    });
  } catch (error) {
    if (isRequestAborted(error, req, res)) return;
    if (error instanceof Error && error.message === "Request is too large.") {
      sendJson(res, 413, { error: "Initial Fit inputs are too large. Shorten the job or resume and try again." });
      return;
    }
    const failure = reviewFailureFromReason(error, provider);
    if (error instanceof UserSafeAiError || error instanceof FetchTimeoutError || failure.status !== 502) {
      sendJson(res, failure.status, { error: failure.message });
      return;
    }
    console.warn("[ai] initial fit audit failed", {
      provider,
      errorName: error instanceof Error ? error.name : typeof error
    });
    sendJson(res, failure.status, { error: failure.message });
  } finally {
    request.dispose();
  }
}
