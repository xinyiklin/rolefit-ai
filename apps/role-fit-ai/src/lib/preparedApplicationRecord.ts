import type { JobAnalysisWarning } from "../../shared/jobAnalysisWarnings.ts";
import type { Application } from "../hooks/useApplications.ts";
import type { ExtractedJobTracking } from "./jobExtract.ts";
import { RESUME_POLISH_REVIEW_USAGE_KEY, copyAiUsage, type StageAiUsage } from "./aiUsage.ts";
import { dedupeSourceUrls } from "./jobIdentity.ts";
import type { FitAssessmentPersistenceDecision } from "./fitAssessmentLifecycle.ts";

type PreparedApplicationRecordArgs = {
  base: Application;
  existing: Application | null;
  jobUrl: string;
  preparedJobDescription: string;
  jobWarnings?: JobAnalysisWarning[];
  jobRawText: string;
  tracking: ExtractedJobTracking;
  pipelineAiUsage: Record<string, StageAiUsage>;
  fitAssessmentPersistence: FitAssessmentPersistenceDecision;
  now: string;
  usage:
    | { mode: "job-only" }
    | {
        mode: "application";
        includeResume: boolean;
        includeCoverLetter: boolean;
        resumeUsed: "base" | "tailored";
      };
};

export function preparedApplicationRecord({
  base,
  existing,
  jobUrl,
  preparedJobDescription,
  jobWarnings,
  jobRawText,
  tracking,
  pipelineAiUsage,
  fitAssessmentPersistence,
  now,
  usage
}: PreparedApplicationRecordArgs): {
  application: Application;
  clearFields: readonly (keyof Application)[];
} {
  const aiUsage: Record<string, StageAiUsage> = usage.mode === "job-only"
    ? {}
    : copyAiUsage(existing?.aiUsage);
  aiUsage["job-analysis"] = pipelineAiUsage["job-analysis"] ?? { source: "none" };
  if (usage.mode === "application") {
    if (usage.includeResume) {
      aiUsage["resume-polish"] = pipelineAiUsage["resume-polish"] ?? { source: "none" };
      // The review receipt describes that same Polish run, so an unreviewed run clears an older one.
      const review = pipelineAiUsage[RESUME_POLISH_REVIEW_USAGE_KEY];
      if (review) aiUsage[RESUME_POLISH_REVIEW_USAGE_KEY] = review;
      else delete aiUsage[RESUME_POLISH_REVIEW_USAGE_KEY];
    }
    if (usage.includeCoverLetter) {
      if (pipelineAiUsage["cover-polish"]) aiUsage["cover-polish"] = pipelineAiUsage["cover-polish"];
      else delete aiUsage["cover-polish"];
    }
  }

  const nextJobUrl = jobUrl.trim();
  const priorJobUrl = existing?.jobUrl.trim() ?? "";
  const sourceUrls = dedupeSourceUrls(
    [
      ...(existing?.sourceUrls ?? []),
      ...(priorJobUrl && priorJobUrl !== nextJobUrl
        ? [{ url: priorJobUrl, source: existing?.source, addedAt: now }]
        : [])
    ],
    nextJobUrl,
    now
  );

  return {
    application: {
      ...base,
      title:
        [tracking.role || tracking.title, tracking.company]
          .map((value) => String(value ?? "").trim())
          .filter(Boolean)
          .join(" at ") || base.title,
      company: String(tracking.company ?? "").trim(),
      role: String(tracking.role || tracking.title || "").trim(),
      source: base.source,
      jobUrl: nextJobUrl,
      jobDescription: preparedJobDescription.trim(),
      rawJobDescription: jobRawText.trim(),
      jobWarnings: jobWarnings?.length ? jobWarnings : undefined,
      roleDescription: String(tracking.roleDescription ?? "").trim(),
      location: String(tracking.location ?? "").trim(),
      jobType: String(tracking.jobType ?? "").trim(),
      workAuth: String(tracking.workAuth ?? "").trim(),
      salaryMin: tracking.salaryMin ?? null,
      salaryMax: tracking.salaryMax ?? null,
      salaryCurrency: String(tracking.salaryCurrency ?? "").trim(),
      salaryPeriod: tracking.salaryPeriod || undefined,
      sourceUrls: sourceUrls.length ? sourceUrls : undefined,
      aiUsage,
      ...(fitAssessmentPersistence.action === "set"
        ? { fitAssessment: fitAssessmentPersistence.snapshot }
        : fitAssessmentPersistence.action === "clear"
          ? { fitAssessment: undefined }
          : {}),
      ...(usage.mode === "application" && usage.includeResume
        ? { resumeUsed: usage.resumeUsed }
        : {})
    },
    clearFields: [
      ...(!jobWarnings?.length ? ["jobWarnings" as const] : []),
      ...(fitAssessmentPersistence.action === "clear" ? ["fitAssessment" as const] : []),
      ...(!tracking.salaryPeriod ? ["salaryPeriod" as const] : [])
    ]
  };
}
