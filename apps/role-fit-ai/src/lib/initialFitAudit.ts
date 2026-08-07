import { buildInitialFitAuditFingerprint } from "../../shared/initialFitAuditContract.ts";
import {
  parseFitAssessment,
  type FitAssessment
} from "../../shared/fitAssessmentContract.ts";
import type { StageConfig } from "./aiRequest.ts";
import type { StageAiUsage } from "./aiUsage.ts";

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
  assessment: FitAssessment;
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

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseUsage(value: unknown, completedAt: string): StageAiUsage | null {
  const usage = record(value);
  if (!usage || usage.source !== "ai") return null;
  if (!hasOnlyKeys(usage, ["source", "provider", "model", "reasoningEffort", "attempts", "completedAt"])) return null;
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
  if (!hasOnlyKeys(source, [
    "preparationId",
    "fingerprint",
    "resumeFileName",
    "resumeDocumentVersion",
    "assessment",
    "completedAt",
    "usage"
  ])) return null;
  const expectedFingerprint = initialFitAuditFingerprint(input);
  if (
    source.preparationId !== input.preparationId ||
    source.fingerprint !== expectedFingerprint ||
    source.resumeFileName !== input.resumeFileName ||
    source.resumeDocumentVersion !== input.resumeDocumentVersion
  ) return null;
  const assessment = parseFitAssessment(source.assessment);
  if (!assessment) return null;
  if (
    !nonEmptyString(source.completedAt) ||
    !Number.isFinite(Date.parse(source.completedAt)) ||
    new Date(source.completedAt).toISOString() !== source.completedAt
  ) return null;
  const usage = parseUsage(source.usage, source.completedAt);
  if (!usage) return null;
  return {
    preparationId: input.preparationId,
    fingerprint: expectedFingerprint,
    resumeFileName: input.resumeFileName,
    resumeDocumentVersion: input.resumeDocumentVersion,
    assessment,
    completedAt: source.completedAt,
    usage
  };
}
