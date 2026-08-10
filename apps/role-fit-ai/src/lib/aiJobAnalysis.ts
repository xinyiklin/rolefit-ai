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
import {
  sanitizeFitAssessment,
  type FitAssessmentResult
} from "../../shared/fitAssessmentContract.ts";

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
  fitAssessment?: unknown;
  fitAssessmentStatus?: unknown;
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
  fitAssessmentRequested: boolean;
  fitAssessment: FitAssessmentResult | null;
};

export type FitAssessmentRequest = {
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
    fitAssessmentRequested?: boolean;
  } = {}
): JobAnalysisResult {
  const extracted = options.localExtracted ?? extractJobPosting(text, { url: options.url });
  if (!options.failure) {
    return {
      extracted,
      source: "local",
      usage: localOnlyUsage(),
      fitAssessmentRequested: options.fitAssessmentRequested ?? false,
      fitAssessment: null
    };
  }
  return {
    extracted,
    source: "local",
    usage: localFallbackUsage(options.aiRequest),
    failure: options.failure,
    fitAssessmentRequested: options.fitAssessmentRequested ?? false,
    fitAssessment: null
  };
}

function definedFields<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== "")) as Partial<T>;
}

type JobAnalysisFailure = { failure: ClassifiedFailure };
type AnalysisApiOutcome = { mode: "analysis"; fields: Partial<AiJobAnalysisFields> };
type FitAssessmentApiOutcome = { mode: "fit-assessment"; fitAssessment: FitAssessmentResult };
type JobAnalysisApiOutcome = AnalysisApiOutcome | FitAssessmentApiOutcome | JobAnalysisFailure;

function postJobAnalysisRequest(
  payload: Record<string, unknown>,
  options: { mode: "analysis"; signal?: AbortSignal }
): Promise<AnalysisApiOutcome | JobAnalysisFailure>;
function postJobAnalysisRequest(
  payload: Record<string, unknown>,
  options: { mode: "fit-assessment"; signal?: AbortSignal }
): Promise<FitAssessmentApiOutcome | JobAnalysisFailure>;
async function postJobAnalysisRequest(
  payload: Record<string, unknown>,
  options: { mode: "analysis" | "fit-assessment"; signal?: AbortSignal }
): Promise<JobAnalysisApiOutcome> {
  const { mode, signal } = options;
  try {
    const response = await fetch("/api/job-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal
    });
    if (!response.ok) {
      let message = mode === "analysis"
        ? "AI job analysis request failed"
        : "Fit Assessment request failed";
      try {
        const body = await response.json() as { error?: unknown };
        if (typeof body.error === "string" && body.error.trim()) message = body.error.trim();
      } catch {
        // The status code still classifies a non-JSON failure safely.
      }
      return { failure: classifyFailure(new ApiError(message, response.status)) };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      const message = mode === "analysis"
        ? "The job analyzer returned an unparseable response"
        : "Fit Assessment returned unreadable JSON";
      return { failure: classifyFailure(new ApiError(message, 502)) };
    }

    if (mode === "analysis") {
      if (!body || typeof body !== "object" || Array.isArray(body) || (body as { source?: unknown }).source !== "ai") {
        return {
          failure: classifyFailure(new ApiError("The job analyzer returned an invalid response", 502))
        };
      }
      return { mode, fields: body as Partial<AiJobAnalysisFields> };
    }

    const fitAssessment = body && typeof body === "object" && !Array.isArray(body)
      ? sanitizeFitAssessment((body as { fitAssessment?: unknown }).fitAssessment)
      : null;
    return fitAssessment
      ? { mode, fitAssessment }
      : {
          failure: classifyFailure(new ApiError("Fit Assessment returned no usable screening", 502))
        };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { failure: classifyFailure(error) };
  }
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
// "Usable AI content" mirrors the other model-backed stages' usable-response
// guards: a reply the
// server grounded down to nothing of substance is an AI no-op. A bare title or
// other metadata scalar does NOT count — the deterministic engine extracts those
// too, so reporting them as "ai" mislabels a failure as success while the same
// misbehaving provider makes Resume Polish show a fallback. We key off ONLY the
// server-grounded content lists (responsibilities/qualifications/tech/seniority/
// domain). roleDescription is deliberately NOT a signal here: a grounded summary
// alone still provides no actionable requirements for polishing. When all lists
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
  fitAssessmentRequested = false
): JobAnalysisResult {
  // The server sanitizes the job subsection and the Fit Assessment subsection
  // independently, so a valid screening can arrive beside job fields too weak
  // to use. Discarding the fit with them threw away a good half of the one
  // combined request and invited a second assessment-only call; the two sources stay
  // independent here for the same reason.
  const fitAssessment = fitAssessmentRequested ? sanitizeFitAssessment(fields?.fitAssessment) : null;
  if (fields && hasUsableAiContent(fields)) {
    return {
      extracted: buildExtractedFromAi(fields, text, url),
      source: "ai",
      usage: aiUsageFromFields(fields),
      fitAssessmentRequested,
      fitAssessment
    };
  }
  return {
    extracted: localExtracted ?? extractJobPosting(text, { url }),
    source: "local",
    usage: localFallbackUsage(aiRequest),
    failure: classifyFailure(new ApiError("The job analyzer returned no usable job requirements", 502)),
    fitAssessmentRequested,
    fitAssessment
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
    fitAssessment?: FitAssessmentRequest;
    // Precomputed extractJobPosting(text, { url }) result from a caller's own
    // gate parse (same text/url). Every local-fallback branch below reuses it
    // instead of re-running the parser; falls back to computing it here, once,
    // memoized, when the caller didn't have one ready (or its text/url diverged
    // from what it fed the gate parse — see useJobIntake.ts call sites).
    localExtracted?: ExtractedJobPosting;
  } = {}
): Promise<JobAnalysisResult> {
  const { url, signal, aiRequest, fitAssessment, localExtracted } = options;
  const fitAssessmentRequested = Boolean(fitAssessment?.resumeText.trim());
  let memoizedLocalExtracted: ExtractedJobPosting | undefined;
  const resolveLocalExtracted = (): ExtractedJobPosting =>
    localExtracted ?? (memoizedLocalExtracted ??= extractJobPosting(text, { url }));
  // No AI attempted at all (text too short to bother calling out).
  const localOnly = (): JobAnalysisResult => localJobAnalysisResult(text, {
    url,
    localExtracted: resolveLocalExtracted(),
    fitAssessmentRequested
  });
  // An AI call was made but didn't produce a usable result.
  const localAfterAttempt = (failure: ClassifiedFailure): JobAnalysisResult => localJobAnalysisResult(text, {
    url,
    aiRequest,
    localExtracted: resolveLocalExtracted(),
    failure,
    fitAssessmentRequested
  });
  if (text.trim().length < 40) return localOnly();

  const outcome = await postJobAnalysisRequest(
    {
      text,
      url,
      ...(aiRequest ?? {}),
      ...(fitAssessmentRequested
        ? {
            fitAssessment: {
              enabled: true,
              resumeText: fitAssessment?.resumeText,
              candidateContext: fitAssessment?.candidateContext
            }
          }
        : {})
    },
    { mode: "analysis", signal }
  );
  if ("failure" in outcome) return localAfterAttempt(outcome.failure);
  return extractedFromAiOrLocal(
    outcome.fields,
    text,
    url,
    aiRequest,
    localExtracted,
    fitAssessmentRequested
  );
}

export async function analyzeFitAssessment(
  text: string,
  request: FitAssessmentRequest,
  options: { signal?: AbortSignal; aiRequest?: Partial<AiRequestFields> } = {}
): Promise<{ fitAssessment: FitAssessmentResult | null; failure?: ClassifiedFailure }> {
  const outcome = await postJobAnalysisRequest(
    {
      text,
      mode: "fit-assessment",
      resumeText: request.resumeText,
      candidateContext: request.candidateContext,
      ...(options.aiRequest ?? {})
    },
    { mode: "fit-assessment", signal: options.signal }
  );
  return "failure" in outcome
    ? { fitAssessment: null, failure: outcome.failure }
    : { fitAssessment: outcome.fitAssessment };
}
