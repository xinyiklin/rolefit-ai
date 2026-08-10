import { parseResumeFile } from "@typeset/engine/lib/resumeFile.ts";

import type { StageAiUsage } from "./aiUsage.ts";
import { isResumeOrigin, type ResumeOrigin } from "./resumeOrigin.ts";

export type AutosavedDraft = {
  // Strict editable source, including header structure and document style.
  resumeSource: string;
  resumeOrigin: ResumeOrigin;
  savedAt: string;
  // Light job-target label only; never the full job description.
  jobLabel: string;
  pipelineAiUsage?: Record<string, StageAiUsage>;
  jobRawText?: string;
  // Compact target identity hash; never raw job content.
  jobKeyHash?: string;
};

export function parseResumeAutosaveDraft(
  raw: string | null
): AutosavedDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AutosavedDraft>;
    if (
      typeof parsed.savedAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.savedAt))
    ) {
      return null;
    }
    if (typeof parsed.resumeSource !== "string" || !parsed.resumeSource.trim()) {
      return null;
    }
    if (!isResumeOrigin(parsed.resumeOrigin)) return null;
    parseResumeFile(parsed.resumeSource);
    const resumeSource = parsed.resumeSource;
    return {
      resumeSource,
      resumeOrigin: parsed.resumeOrigin,
      savedAt: parsed.savedAt,
      jobLabel: typeof parsed.jobLabel === "string" ? parsed.jobLabel : "",
      ...(parsed.pipelineAiUsage && typeof parsed.pipelineAiUsage === "object"
        ? { pipelineAiUsage: parsed.pipelineAiUsage }
        : {}),
      ...(typeof parsed.jobRawText === "string"
        ? { jobRawText: parsed.jobRawText }
        : {}),
      ...(typeof parsed.jobKeyHash === "string"
        ? { jobKeyHash: parsed.jobKeyHash }
        : {})
    };
  } catch {
    return null;
  }
}
