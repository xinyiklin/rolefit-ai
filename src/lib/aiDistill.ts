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

// The structured fields /api/distill returns (already grounded/anti-fab on the
// server). Every field is optional at runtime — the model output is untrusted.
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
};

const PERIODS: ExtractedSalaryPeriod[] = ["yr", "mo", "hr"];

const strArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const str = (value: unknown): string => (typeof value === "string" ? value : "");

// Map the (untrusted) AI fields onto the deterministic engine's ExtractedJobPosting
// shape, reusing the shared scaffold builder and manualReviewFields.
export function buildExtractedFromAi(fields: Partial<AiDistillFields>, sourceText: string, url?: string): ExtractedJobPosting {
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

export type DistillResult = { extracted: ExtractedJobPosting; source: "ai" | "local" };

// Build from AI fields, but fall back to the deterministic engine when the AI
// surfaced no usable core content (no title AND placeholder responsibilities AND
// placeholder required quals) — the deterministic engine may catch structure the
// model missed. `fields === null` means the AI distill failed/was absent. Shared
// by the client `/api/distill` path and the extension import (distilled server-side).
export function extractedFromAiOrLocal(
  fields: Partial<AiDistillFields> | null,
  text: string,
  url?: string
): DistillResult {
  if (fields) {
    const extracted = buildExtractedFromAi(fields, text, url);
    const coreMissing =
      !extracted.tracking.title &&
      /\[manual input needed: core responsibilities\]/.test(extracted.tailoringText) &&
      /\[manual input needed: required qualifications\]/.test(extracted.tailoringText);
    if (!coreMissing) return { extracted, source: "ai" };
  }
  return { extracted: extractJobPosting(text, { url }), source: "local" };
}

// Distill raw posting text. AI-first with a deterministic fallback on any failure.
// Returns which engine produced the result so the UI can note when AI was used.
export async function distillJobPosting(
  text: string,
  options: { url?: string; signal?: AbortSignal } = {}
): Promise<DistillResult> {
  const { url, signal } = options;
  const local = (): DistillResult => ({ extracted: extractJobPosting(text, { url }), source: "local" });
  if (text.trim().length < 40) return local();

  try {
    const res = await fetch("/api/distill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, url }),
      signal
    });
    if (!res.ok) return local();
    const fields = (await res.json()) as Partial<AiDistillFields> | null;
    if (!fields || fields.source !== "ai") return local();
    return extractedFromAiOrLocal(fields, text, url);
  } catch (error) {
    // A genuine cancel should propagate; everything else falls back locally.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return local();
  }
}
