import type { Application } from "../hooks/useApplications.ts";
import type { ExtractedJobTracking } from "./jobExtract.ts";
import { copyAiUsage, type StageAiUsage } from "./aiUsage.ts";
import { dedupeSourceUrls } from "./jobIdentity.ts";
import type { FitAssessmentPersistenceDecision } from "./fitAssessmentLifecycle.ts";

type PreparedApplicationRecordArgs = {
  draft: Application;
  existing: Application | null;
  jobUrl: string;
  preparedJobDescription: string;
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
  draft,
  existing,
  jobUrl,
  preparedJobDescription,
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
    }
    if (usage.includeCoverLetter) {
      if (pipelineAiUsage.cover) aiUsage.cover = pipelineAiUsage.cover;
      else delete aiUsage.cover;
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
      ...draft,
      title:
        [tracking.role || tracking.title, tracking.company]
          .map((value) => String(value ?? "").trim())
          .filter(Boolean)
          .join(" at ") || draft.title,
      company: String(tracking.company ?? "").trim(),
      role: String(tracking.role || tracking.title || "").trim(),
      source: draft.source,
      jobUrl: nextJobUrl,
      jobDescription: preparedJobDescription.trim(),
      rawJobDescription: jobRawText.trim(),
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
      ...(fitAssessmentPersistence.action === "clear" ? ["fitAssessment" as const] : []),
      ...(!tracking.salaryPeriod ? ["salaryPeriod" as const] : [])
    ]
  };
}
