import { buildInitialFitAuditFingerprint } from "../../shared/initialFitAuditContract.ts";
import type { StageConfig } from "./aiRequest.ts";
import type { StageAiUsage } from "./aiUsage.ts";
import { verdictFromScore } from "./fitVerdict.ts";
import type { StrictReview, StrictReviewVerdict } from "../resume/types.ts";

export type InitialFitAuditInput = {
  preparationId: string;
  jobText: string;
  resumeFileName: string;
  resumeDocumentVersion: string;
  resumeText: string;
  honestContext: string;
  reviewInstructions: string;
  review: StageConfig;
};

export type InitialFitAudit = {
  preparationId: string;
  fingerprint: string;
  resumeFileName: string;
  resumeDocumentVersion: string;
  score: number;
  verdict: StrictReviewVerdict;
  verdictReason: string;
  review: StrictReview;
  completedAt: string;
  usage: StageAiUsage;
};

export function initialFitAuditFingerprint(input: InitialFitAuditInput): string {
  return buildInitialFitAuditFingerprint({
    preparationId: input.preparationId,
    jobText: input.jobText,
    resumeFileName: input.resumeFileName,
    resumeDocumentVersion: input.resumeDocumentVersion,
    resumeText: input.resumeText,
    honestContext: input.honestContext,
    provider: input.review.provider,
    model: input.review.selectedModel,
    reasoningEffort: input.review.cliReasoningEffort,
    instructions: input.reviewInstructions
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isReviewShape(value: unknown, verdict: StrictReviewVerdict, reason: string): value is StrictReview {
  const review = record(value);
  const recommendation = record(review?.recommendation);
  return Boolean(
    review &&
    review.verdict === verdict &&
    review.verdictReason === reason &&
    Array.isArray(review.coverage) &&
    Array.isArray(review.gaps) &&
    Array.isArray(review.rewrites) &&
    Array.isArray(review.riskFlags) &&
    recommendation &&
    typeof recommendation.applyAsIs === "boolean" &&
    typeof recommendation.reason === "string" &&
    Array.isArray(recommendation.topEdits) &&
    typeof recommendation.coverLetterAngle === "string"
  );
}

function parseUsage(value: unknown, completedAt: string): StageAiUsage | null {
  const usage = record(value);
  if (!usage || usage.source !== "ai") return null;
  if (!nonEmptyString(usage.provider) || !nonEmptyString(usage.model)) return null;
  if (usage.reasoningEffort !== undefined && typeof usage.reasoningEffort !== "string") return null;
  if (usage.attempts !== undefined && (!Number.isInteger(usage.attempts) || Number(usage.attempts) < 0)) return null;
  if (usage.completedAt !== completedAt) return null;
  return {
    source: "ai",
    provider: usage.provider,
    model: usage.model,
    ...(typeof usage.reasoningEffort === "string" ? { reasoningEffort: usage.reasoningEffort } : {}),
    ...(typeof usage.attempts === "number" ? { attempts: usage.attempts } : {}),
    completedAt
  };
}

export function parseInitialFitAuditResponse(
  value: unknown,
  input: InitialFitAuditInput
): InitialFitAudit | null {
  const source = record(value);
  if (!source) return null;
  const expectedFingerprint = initialFitAuditFingerprint(input);
  if (
    source.preparationId !== input.preparationId ||
    source.fingerprint !== expectedFingerprint ||
    source.resumeFileName !== input.resumeFileName ||
    source.resumeDocumentVersion !== input.resumeDocumentVersion
  ) return null;
  if (typeof source.score !== "number" || !Number.isInteger(source.score) || source.score < 0 || source.score > 100) return null;
  const verdict = verdictFromScore(source.score);
  if (!verdict || source.verdict !== verdict || !nonEmptyString(source.verdictReason)) return null;
  if (
    !nonEmptyString(source.completedAt) ||
    !Number.isFinite(Date.parse(source.completedAt)) ||
    new Date(source.completedAt).toISOString() !== source.completedAt
  ) return null;
  if (!isReviewShape(source.review, verdict, source.verdictReason)) return null;
  const usage = parseUsage(source.usage, source.completedAt);
  if (!usage) return null;
  return {
    preparationId: input.preparationId,
    fingerprint: expectedFingerprint,
    resumeFileName: input.resumeFileName,
    resumeDocumentVersion: input.resumeDocumentVersion,
    score: source.score,
    verdict,
    verdictReason: source.verdictReason,
    review: source.review,
    completedAt: source.completedAt,
    usage
  };
}
