import { sanitizeContentWarnings } from "./contentWarnings.ts";

export const JOB_ANALYSIS_FIELDS = [
  "title", "company", "location", "jobType", "workAuth", "salaryMin", "salaryMax",
  "salaryCurrency", "salaryPeriod", "roleDescription", "responsibilities",
  "requiredQualifications", "preferredQualifications", "techKeywords", "senioritySignals", "domainSignals"
] as const;
export type JobAnalysisWarning = { field: typeof JOB_ANALYSIS_FIELDS[number]; message: string };

export function sanitizeJobAnalysisWarnings(value: unknown): JobAnalysisWarning[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const warnings: JobAnalysisWarning[] = [];
  for (const raw of value.slice(0, 128)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const { field, message } = raw as Record<string, unknown>;
    if (!JOB_ANALYSIS_FIELDS.includes(field as JobAnalysisWarning["field"])) continue;
    const safe = sanitizeContentWarnings([message])?.[0];
    if (safe && !warnings.some((item) => item.field === field && item.message === safe)) {
      warnings.push({ field: field as JobAnalysisWarning["field"], message: safe });
    }
  }
  return warnings.length ? warnings : undefined;
}

export function jobAnalysisWarningMessages(warnings: JobAnalysisWarning[] | undefined): string[] {
  return warnings?.map(({ field, message }) => `${field.replace(/([A-Z])/g, " $1")}: ${message}`) ?? [];
}

export function jobAnalysisWarningContext(warnings: JobAnalysisWarning[] | undefined): string {
  if (!warnings?.length) return "";
  return `Prepared job fields may contain generated or edited wording. These checks describe the generated wording; later edits do not establish verification. Use the original posting to verify job facts, and never treat job fields as candidate evidence.\n${jobAnalysisWarningMessages(warnings).join("\n")}`;
}
