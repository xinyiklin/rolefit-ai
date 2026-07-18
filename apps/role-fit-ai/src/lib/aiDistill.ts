// Client-side distill orchestrator. Tries the AI distiller (POST /api/distill,
// keys stay server-side) and falls back to the deterministic engine on ANY
// failure — no key, timeout, network error, or an unusable model reply — so
// distillation always produces a result. Both paths return the SAME
// ExtractedJobPosting shape (shared scaffold + manualReviewFields), so the rest
// of the app is identical regardless of which distiller ran.

import {
  assembleTailoringText,
  extractJobPosting,
  manualReviewFields,
  sourceFromUrl,
  type ExtractedJobPosting,
  type ExtractedJobTracking,
  type ExtractedSalaryPeriod
} from "./jobExtract";
import type { AiRequestFields } from "./aiRequest";
import type { StageAiUsage } from "./aiUsage";
import { ApiError, classifyFailure, type ClassifiedFailure } from "./failures";

// The structured fields /api/distill returns (already grounded/anti-fab on the
// server). Every field is optional at runtime — the model output is untrusted.
// provider/model/reasoningEffort/attempts are the resolved-request echo the
// server adds alongside the distilled content, used only for aiUsage attribution.
export type AiDistillFields = {
  source: "ai";
  title: string;
  company: string;
  location: string;
  jobType: string;
  workAuth: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  salaryPeriod: string;
  roleDescription: string;
  responsibilities: string[];
  requiredQualifications: string[];
  preferredQualifications: string[];
  techKeywords: string[];
  senioritySignals: string[];
  domainSignals: string[];
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  attempts?: number;
};

const PERIODS: ExtractedSalaryPeriod[] = ["yr", "mo", "hr"];

const strArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const str = (value: unknown): string => (typeof value === "string" ? value : "");

// Map the (untrusted) AI fields onto the deterministic engine's ExtractedJobPosting
// shape, reusing the shared scaffold builder and manualReviewFields.
function buildExtractedFromAi(fields: Partial<AiDistillFields>, sourceText: string, url?: string): ExtractedJobPosting {
  const title = str(fields.title);
  const salaryMin = num(fields.salaryMin);
  const salaryMax = num(fields.salaryMax);
  const hasSalary = salaryMin != null || salaryMax != null;
  const roleDescription = str(fields.roleDescription);
  const period = str(fields.salaryPeriod) as ExtractedSalaryPeriod;

  const tracking: ExtractedJobTracking = {
    title: title || undefined,
    role: title || undefined,
    company: str(fields.company) || undefined,
    source: sourceFromUrl(url) || undefined,
    location: str(fields.location) || undefined,
    jobType: str(fields.jobType) || undefined,
    workAuth: str(fields.workAuth) || undefined,
    salaryMin: hasSalary ? salaryMin : undefined,
    salaryMax: hasSalary ? salaryMax : undefined,
    salaryCurrency: hasSalary ? str(fields.salaryCurrency) || undefined : undefined,
    salaryPeriod: hasSalary && PERIODS.includes(period) ? period : undefined,
    roleDescription: roleDescription || undefined
  };

  const tailoringText = assembleTailoringText({
    title,
    context: roleDescription,
    responsibilities: strArray(fields.responsibilities),
    required: strArray(fields.requiredQualifications),
    preferred: strArray(fields.preferredQualifications),
    tech: strArray(fields.techKeywords),
    seniority: strArray(fields.senioritySignals),
    domains: strArray(fields.domainSignals)
  });

  const result: ExtractedJobPosting = {
    tailoringText,
    roleDescription,
    tracking,
    manualReviewFields: [],
    sourceTextLength: sourceText.length
  };
  result.manualReviewFields = manualReviewFields(result);
  return result;
}

export type DistillResult = {
  extracted: ExtractedJobPosting;
  source: "ai" | "local";
  usage: StageAiUsage;
  failure?: ClassifiedFailure;
};

function definedFields<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== "")) as Partial<T>;
}

// Usage attribution for an AI-accepted distill: the resolved provider/model
// echo the server attaches to a successful /api/distill response.
function aiUsageFromFields(fields: Partial<AiDistillFields>): StageAiUsage {
  return {
    source: "ai",
    ...definedFields({ provider: fields.provider, model: fields.model, reasoningEffort: fields.reasoningEffort }),
    ...(typeof fields.attempts === "number" ? { attempts: fields.attempts } : {}),
    completedAt: new Date().toISOString()
  };
}

// Usage attribution for a local result reached after attempting AI (a real
// call was made but returned nothing usable, an error, or a non-ok response).
function localFallbackUsage(aiRequest?: Partial<AiRequestFields>): StageAiUsage {
  return {
    source: "local",
    fallback: true,
    ...definedFields({ requestedProvider: aiRequest?.provider, requestedModel: aiRequest?.model }),
    completedAt: new Date().toISOString()
  };
}

// Usage attribution for a local result reached WITHOUT attempting AI at all
// (e.g. the text was too short to bother calling out).
function localOnlyUsage(): StageAiUsage {
  return { source: "local", completedAt: new Date().toISOString() };
}

// Build from AI fields, but fall back to the deterministic engine when the AI
// surfaced no usable *content* — the deterministic engine may catch structure the
// model missed, and "Distilled with AI" should only be claimed when the model
// actually produced a tailoring brief. `fields === null` means the AI distill
// failed/was absent. Shared by the client `/api/distill` path and the extension
// import (both distill client-side through `/api/distill`; the extension's server
// pass only prepares the raw text).
//
// "Usable AI content" mirrors the tailor pass's usable-response guard (needs
// suggestions/gaps/summary) and review's reviewStatus="failed": a reply the
// server grounded down to nothing of substance is an AI no-op. A bare title or
// other metadata scalar does NOT count — the deterministic engine extracts those
// too, so reporting them as "ai" mislabels a failure as success while the same
// misbehaving provider makes tailor/review show a fallback. We key off ONLY the
// server-grounded content lists (responsibilities/qualifications/tech/seniority/
// domain). roleDescription is deliberately NOT a signal here: it is the one field
// sanitizeDistill passes through ungrounded, so a fabricated 1-3 sentence summary
// must not by itself qualify a reply as "ai" (that would reopen the false-success
// this guard closes). When all lists are empty we defer to the local engine and
// label the result "local" honestly.
function hasUsableAiContent(fields: Partial<AiDistillFields>): boolean {
  return (
    strArray(fields.responsibilities).length > 0 ||
    strArray(fields.requiredQualifications).length > 0 ||
    strArray(fields.preferredQualifications).length > 0 ||
    strArray(fields.techKeywords).length > 0 ||
    strArray(fields.senioritySignals).length > 0 ||
    strArray(fields.domainSignals).length > 0
  );
}

// `aiRequest` is only used for fallback attribution (which provider/model was
// CONFIGURED when the AI content turned out unusable) — it does not affect
// which branch is taken.
// `localExtracted` lets a caller that already ran extractJobPosting on this
// same text/url (e.g. the duplicate-before gate) hand the result in instead of
// paying for a second pass through the deterministic parser. Only consulted on
// the local-fallback branch — the AI-success branch never needed a local parse.
export function extractedFromAiOrLocal(
  fields: Partial<AiDistillFields> | null,
  text: string,
  url?: string,
  aiRequest?: Partial<AiRequestFields>,
  localExtracted?: ExtractedJobPosting
): DistillResult {
  if (fields && hasUsableAiContent(fields)) {
    return { extracted: buildExtractedFromAi(fields, text, url), source: "ai", usage: aiUsageFromFields(fields) };
  }
  return {
    extracted: localExtracted ?? extractJobPosting(text, { url }),
    source: "local",
    usage: localFallbackUsage(aiRequest),
    failure: classifyFailure(new ApiError("The distiller returned no usable job requirements", 502))
  };
}

// Distill raw posting text. AI-first with a deterministic fallback on any failure.
// Returns which engine produced the result so the UI can note when AI was used,
// plus a StageAiUsage snapshot for the app's per-stage AI-usage tracker.
export async function distillJobPosting(
  text: string,
  options: {
    url?: string;
    signal?: AbortSignal;
    aiRequest?: Partial<AiRequestFields>;
    // Precomputed extractJobPosting(text, { url }) result from a caller's own
    // gate parse (same text/url). Every local-fallback branch below reuses it
    // instead of re-running the parser; falls back to computing it here, once,
    // memoized, when the caller didn't have one ready (or its text/url diverged
    // from what it fed the gate parse — see useJobIntake.ts call sites).
    localExtracted?: ExtractedJobPosting;
  } = {}
): Promise<DistillResult> {
  const { url, signal, aiRequest, localExtracted } = options;
  let memoizedLocalExtracted: ExtractedJobPosting | undefined;
  const resolveLocalExtracted = (): ExtractedJobPosting =>
    localExtracted ?? (memoizedLocalExtracted ??= extractJobPosting(text, { url }));
  // No AI attempted at all (text too short to bother calling out).
  const localOnly = (): DistillResult => ({ extracted: resolveLocalExtracted(), source: "local", usage: localOnlyUsage() });
  // An AI call was made but didn't produce a usable result.
  const localAfterAttempt = (failure: ClassifiedFailure): DistillResult => ({
    extracted: resolveLocalExtracted(),
    source: "local",
    usage: localFallbackUsage(aiRequest),
    failure
  });
  if (text.trim().length < 40) return localOnly();

  try {
    const res = await fetch("/api/distill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, url, ...(aiRequest ?? {}) }),
      signal
    });
    if (!res.ok) {
      let message = "AI distill request failed";
      try {
        const body = (await res.json()) as { error?: unknown };
        if (typeof body.error === "string" && body.error.trim()) message = body.error.trim();
      } catch {
        // The status code still classifies a non-JSON failure safely.
      }
      return localAfterAttempt(classifyFailure(new ApiError(message, res.status)));
    }
    let fields: Partial<AiDistillFields> | null;
    try {
      fields = (await res.json()) as Partial<AiDistillFields> | null;
    } catch {
      return localAfterAttempt(classifyFailure(new ApiError("The distiller returned an unparseable response", 502)));
    }
    if (!fields || fields.source !== "ai") {
      return localAfterAttempt(classifyFailure(new ApiError("The distiller returned an invalid response", 502)));
    }
    return extractedFromAiOrLocal(fields, text, url, aiRequest, localExtracted);
  } catch (error) {
    // A genuine cancel should propagate; everything else falls back locally.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return localAfterAttempt(classifyFailure(error));
  }
}
