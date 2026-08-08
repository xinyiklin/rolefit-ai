// Client-side Job analysis orchestrator. Tries the AI analyzer (POST /api/job-analysis,
// keys stay server-side) and falls back to the deterministic engine on ANY
// failure — no key, timeout, network error, or an unusable model reply — so
// job analysis always produces a result. Both paths return the SAME
// ExtractedJobPosting shape (shared scaffold + manualReviewFields), so the rest
// of the app is identical regardless of which job analyzer ran.

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
import { sanitizeQuickFit, type QuickFitResult } from "../../shared/quickFitContract.ts";

// The structured fields /api/job-analysis returns (already grounded/anti-fab on the
// server). Every field is optional at runtime — the model output is untrusted.
// provider/model/reasoningEffort/attempts are the resolved-request echo the
// server adds alongside the analyzed content, used only for aiUsage attribution.
export type AiJobAnalysisFields = {
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
  initialFit?: unknown;
  initialFitStatus?: unknown;
};

const PERIODS: ExtractedSalaryPeriod[] = ["yr", "mo", "hr"];

const strArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const str = (value: unknown): string => (typeof value === "string" ? value : "");

// Map the (untrusted) AI fields onto the deterministic engine's ExtractedJobPosting
// shape, reusing the shared scaffold builder and manualReviewFields.
function buildExtractedFromAi(fields: Partial<AiJobAnalysisFields>, sourceText: string, url?: string): ExtractedJobPosting {
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

export type JobAnalysisResult = {
  extracted: ExtractedJobPosting;
  source: "ai" | "local";
  usage: StageAiUsage;
  failure?: ClassifiedFailure;
  initialFitRequested: boolean;
  initialFit: QuickFitResult | null;
};

export type InitialFitRequest = {
  resumeText: string;
  resumeLabel: string;
  candidateContext?: string;
};

export function localJobAnalysisResult(
  text: string,
  options: {
    url?: string;
    aiRequest?: Partial<AiRequestFields>;
    localExtracted?: ExtractedJobPosting;
    failure?: ClassifiedFailure;
    initialFitRequested?: boolean;
  } = {}
): JobAnalysisResult {
  const extracted = options.localExtracted ?? extractJobPosting(text, { url: options.url });
  if (!options.failure) {
    return {
      extracted,
      source: "local",
      usage: localOnlyUsage(),
      initialFitRequested: options.initialFitRequested ?? false,
      initialFit: null
    };
  }
  return {
    extracted,
    source: "local",
    usage: localFallbackUsage(options.aiRequest),
    failure: options.failure,
    initialFitRequested: options.initialFitRequested ?? false,
    initialFit: null
  };
}

function definedFields<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== "")) as Partial<T>;
}

// Usage attribution for an AI-accepted analysis: the resolved provider/model
// echo the server attaches to a successful /api/job-analysis response.
function aiUsageFromFields(fields: Partial<AiJobAnalysisFields>): StageAiUsage {
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
// model missed, and "Analyzed with AI" should only be claimed when the model
// actually produced a tailoring brief. `fields === null` means the AI job analysis
// failed/was absent. Shared by the client `/api/job-analysis` path and the extension
// import (both analyze client-side through `/api/job-analysis`; the extension's server
// pass only prepares the raw text).
//
// "Usable AI content" mirrors the tailor pass's usable-response guard (needs
// suggestions/gaps/summary) and review's reviewStatus="failed": a reply the
// server grounded down to nothing of substance is an AI no-op. A bare title or
// other metadata scalar does NOT count — the deterministic engine extracts those
// too, so reporting them as "ai" mislabels a failure as success while the same
// misbehaving provider makes tailor/review show a fallback. We key off ONLY the
// server-grounded content lists (responsibilities/qualifications/tech/seniority/
// domain). roleDescription is deliberately NOT a signal here: a grounded summary
// alone still provides no actionable requirements for tailoring. When all lists
// are empty we defer to the local engine and label the result "local" honestly.
function hasUsableAiContent(fields: Partial<AiJobAnalysisFields>): boolean {
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
  fields: Partial<AiJobAnalysisFields> | null,
  text: string,
  url?: string,
  aiRequest?: Partial<AiRequestFields>,
  localExtracted?: ExtractedJobPosting,
  initialFitRequested = false
): JobAnalysisResult {
  if (fields && hasUsableAiContent(fields)) {
    return {
      extracted: buildExtractedFromAi(fields, text, url),
      source: "ai",
      usage: aiUsageFromFields(fields),
      initialFitRequested,
      initialFit: initialFitRequested ? sanitizeQuickFit(fields.initialFit) : null
    };
  }
  return {
    extracted: localExtracted ?? extractJobPosting(text, { url }),
    source: "local",
    usage: localFallbackUsage(aiRequest),
    failure: classifyFailure(new ApiError("The job analyzer returned no usable job requirements", 502)),
    initialFitRequested,
    initialFit: null
  };
}

// Analyze raw posting text. AI-first with a deterministic fallback on any failure.
// Returns which engine produced the result so the UI can note when AI was used,
// plus a StageAiUsage snapshot for the app's per-stage AI-usage tracker.
export async function analyzeJobPosting(
  text: string,
  options: {
    url?: string;
    signal?: AbortSignal;
    aiRequest?: Partial<AiRequestFields>;
    initialFit?: InitialFitRequest;
    // Precomputed extractJobPosting(text, { url }) result from a caller's own
    // gate parse (same text/url). Every local-fallback branch below reuses it
    // instead of re-running the parser; falls back to computing it here, once,
    // memoized, when the caller didn't have one ready (or its text/url diverged
    // from what it fed the gate parse — see useJobIntake.ts call sites).
    localExtracted?: ExtractedJobPosting;
  } = {}
): Promise<JobAnalysisResult> {
  const { url, signal, aiRequest, initialFit, localExtracted } = options;
  const initialFitRequested = Boolean(initialFit?.resumeText.trim());
  let memoizedLocalExtracted: ExtractedJobPosting | undefined;
  const resolveLocalExtracted = (): ExtractedJobPosting =>
    localExtracted ?? (memoizedLocalExtracted ??= extractJobPosting(text, { url }));
  // No AI attempted at all (text too short to bother calling out).
  const localOnly = (): JobAnalysisResult => localJobAnalysisResult(text, {
    url,
    localExtracted: resolveLocalExtracted(),
    initialFitRequested
  });
  // An AI call was made but didn't produce a usable result.
  const localAfterAttempt = (failure: ClassifiedFailure): JobAnalysisResult => localJobAnalysisResult(text, {
    url,
    aiRequest,
    localExtracted: resolveLocalExtracted(),
    failure,
    initialFitRequested
  });
  if (text.trim().length < 40) return localOnly();

  try {
    const res = await fetch("/api/job-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        url,
        ...(aiRequest ?? {}),
        ...(initialFitRequested ? { initialFit: { enabled: true, ...initialFit } } : {})
      }),
      signal
    });
    if (!res.ok) {
      let message = "AI job analysis request failed";
      try {
        const body = (await res.json()) as { error?: unknown };
        if (typeof body.error === "string" && body.error.trim()) message = body.error.trim();
      } catch {
        // The status code still classifies a non-JSON failure safely.
      }
      return localAfterAttempt(classifyFailure(new ApiError(message, res.status)));
    }
    let fields: Partial<AiJobAnalysisFields> | null;
    try {
      fields = (await res.json()) as Partial<AiJobAnalysisFields> | null;
    } catch {
      return localAfterAttempt(classifyFailure(new ApiError("The job analyzer returned an unparseable response", 502)));
    }
    if (!fields || fields.source !== "ai") {
      return localAfterAttempt(classifyFailure(new ApiError("The job analyzer returned an invalid response", 502)));
    }
    return extractedFromAiOrLocal(fields, text, url, aiRequest, localExtracted, initialFitRequested);
  } catch (error) {
    // A genuine cancel should propagate; everything else falls back locally.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return localAfterAttempt(classifyFailure(error));
  }
}

export async function analyzeInitialFit(
  text: string,
  request: InitialFitRequest,
  options: { signal?: AbortSignal; aiRequest?: Partial<AiRequestFields> } = {}
): Promise<{ initialFit: QuickFitResult | null; failure?: ClassifiedFailure }> {
  try {
    const response = await fetch("/api/job-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        mode: "initial-fit",
        resumeText: request.resumeText,
        resumeLabel: request.resumeLabel,
        candidateContext: request.candidateContext,
        ...(options.aiRequest ?? {})
      }),
      signal: options.signal
    });
    if (!response.ok) {
      let message = "Initial Fit request failed";
      try {
        const body = await response.json() as { error?: unknown };
        if (typeof body.error === "string" && body.error.trim()) message = body.error.trim();
      } catch {
        // The status still supplies a safe classification.
      }
      return { initialFit: null, failure: classifyFailure(new ApiError(message, response.status)) };
    }
    let body: { initialFit?: unknown };
    try {
      body = await response.json() as { initialFit?: unknown };
    } catch {
      return {
        initialFit: null,
        failure: classifyFailure(new ApiError("Initial Fit returned unreadable JSON", 502))
      };
    }
    const initialFit = sanitizeQuickFit(body.initialFit);
    return initialFit
      ? { initialFit }
      : {
          initialFit: null,
          failure: classifyFailure(new ApiError("Initial Fit returned no usable screening", 502))
        };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { initialFit: null, failure: classifyFailure(error) };
  }
}
